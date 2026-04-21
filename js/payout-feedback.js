// ═══════════════════════════════════════════════════
//  ADMIN PAYOUT MANAGEMENT
// ═══════════════════════════════════════════════════
var _payoutSelectedIds = new Set();
var _payoutAllRows     = [];

window.loadPayoutsTable = async function() {
    var body   = document.getElementById('payoutsTableBody');
    var filter = document.getElementById('payoutFilterStatus') ? document.getElementById('payoutFilterStatus').value : 'all';
    var search = (document.getElementById('payoutSearchInput') ? document.getElementById('payoutSearchInput').value : '').toLowerCase().trim();
    if (!body || !_supabase) return;

    body.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:30px;color:#aaa;"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading...</td></tr>';

    var q = _supabase
        .from('bookings')
        .select('id,booking_reference,guest_name,guest_phone,nights,price_per_unit,total_amount,payout_status,listing_id,listings(id,title,owner_id,profiles!owner_id(id,full_name,phone))')
        .eq('payment_status','paid')
        .order('created_at',{ascending:false})
        .limit(300);

    if (filter === 'pending')     q = q.is('payout_status', null);
    else if (filter === 'processing') q = q.eq('payout_status','processing');
    else if (filter === 'paid')   q = q.eq('payout_status','paid');

    var result = await q;
    var rows = result.data, error = result.error;
    if (error) { body.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:30px;color:#e74c3c;">' + error.message + '</td></tr>'; return; }

    _payoutAllRows = (rows || []).filter(function(r) {
        if (!search) return true;
        var owner = r.listings && r.listings.profiles;
        return [r.guest_name, r.guest_phone, r.booking_reference, r.listings && r.listings.title, owner && owner.full_name, owner && owner.phone]
            .some(function(v) { return (v||'').toLowerCase().indexOf(search) !== -1; });
    });

    var summaryEl = document.getElementById('payoutSummaryCards');
    if (summaryEl) {
        var total      = rows ? rows.length : 0;
        var pending    = (rows||[]).filter(function(r) { return !r.payout_status; }).length;
        var processing = (rows||[]).filter(function(r) { return r.payout_status==='processing'; }).length;
        var paid       = (rows||[]).filter(function(r) { return r.payout_status==='paid'; }).length;
        var totalAmt   = (rows||[]).reduce(function(s,r) { return s + (Number(r.total_amount)||0); }, 0);
        var paidAmt    = (rows||[]).filter(function(r) { return r.payout_status==='paid'; }).reduce(function(s,r) { return s + (Number(r.total_amount)||0); }, 0);
        var cards = [
            ['Paid Bookings', total, '#eff6ff', '#3b82f6'],
            ['Not Paid Out', pending, '#fff8f3', '#EB6753'],
            ['Processing', processing, '#fffbeb', '#c47f2a'],
            ['Paid Out', paid, '#f0fdf4', '#27ae60'],
            ['Total Volume', totalAmt.toLocaleString('en-RW') + ' RWF', '#f5f0ff', '#a855f7'],
            ['Paid Out Volume', paidAmt.toLocaleString('en-RW') + ' RWF', '#f0fdf4', '#27ae60'],
        ];
        summaryEl.innerHTML = cards.map(function(c) {
            return '<div style="background:' + c[2] + ';border-radius:12px;padding:14px 16px;"><div style="font-size:18px;font-weight:800;color:' + c[3] + ';">' + c[1] + '</div><div style="font-size:11px;color:#aaa;margin-top:3px;">' + c[0] + '</div></div>';
        }).join('');
        var badge = document.getElementById('badge-payouts');
        if (badge) { badge.textContent = pending; badge.style.display = pending ? '' : 'none'; }
    }

    if (!_payoutAllRows.length) {
        body.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:40px;color:#aaa;">No bookings found</td></tr>';
        return;
    }

    function fmtMoney(n) { return Number(n||0).toLocaleString('en-RW') + ' RWF'; }
    function psLabel(s) {
        if (!s)               return '<span style="background:#fff8f3;color:#EB6753;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;">Not Paid Out</span>';
        if (s==='processing') return '<span style="background:#fffbeb;color:#c47f2a;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;">Processing</span>';
        if (s==='paid')       return '<span style="background:#f0fdf4;color:#27ae60;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;">Paid Out</span>';
        return s;
    }

    body.innerHTML = _payoutAllRows.map(function(r, i) {
        var owner   = r.listings && r.listings.profiles;
        var ref     = (r.booking_reference || r.id.slice(0,8)).toUpperCase();
        var checked = _payoutSelectedIds.has(r.id) ? 'checked' : '';
        return '<tr id="prow-' + r.id + '">' +
            '<td><input type="checkbox" ' + checked + ' onchange="togglePayoutRow(\'' + r.id + '\',this.checked)"></td>' +
            '<td style="color:#aaa;font-size:12px;">' + (i+1) + '</td>' +
            '<td style="font-family:monospace;font-size:12px;">' + ref + '</td>' +
            '<td style="font-weight:600;">' + (r.guest_name||'—') + '</td>' +
            '<td style="font-size:12px;color:#888;">' + (r.guest_phone||'—') + '</td>' +
            '<td>' + (r.listings ? r.listings.title||'—' : '—') + '</td>' +
            '<td style="text-align:center;">' + (r.nights||'—') + '</td>' +
            '<td>' + (r.price_per_unit ? fmtMoney(r.price_per_unit) : '—') + '</td>' +
            '<td style="font-weight:700;">' + fmtMoney(r.total_amount) + '</td>' +
            '<td style="font-weight:600;">' + (owner ? owner.full_name||'—' : '—') + '</td>' +
            '<td style="font-size:12px;color:#888;">' + (owner ? owner.phone||'—' : '—') + '</td>' +
            '<td>' + psLabel(r.payout_status) + '</td>' +
            '</tr>';
    }).join('');
};

window.togglePayoutRow = function(id, checked) {
    if (checked) _payoutSelectedIds.add(id);
    else         _payoutSelectedIds.delete(id);
    _updatePayoutBulkBar();
};

window.toggleAllPayouts = function(checked) {
    _payoutAllRows.forEach(function(r) {
        if (checked) _payoutSelectedIds.add(r.id);
        else         _payoutSelectedIds.delete(r.id);
    });
    document.querySelectorAll('#payoutsTableBody input[type=checkbox]').forEach(function(cb) { cb.checked = checked; });
    _updatePayoutBulkBar();
};

function _updatePayoutBulkBar() {
    var bar   = document.getElementById('payoutsBulkBar');
    var count = document.getElementById('payoutsBulkCount');
    var n     = _payoutSelectedIds.size;
    if (bar)   bar.style.display = n > 0 ? 'flex' : 'none';
    if (count) count.textContent = n + ' selected';
}

window.clearPayoutSelection = function() {
    _payoutSelectedIds.clear();
    document.querySelectorAll('#payoutsTableBody input[type=checkbox]').forEach(function(cb) { cb.checked = false; });
    var all = document.getElementById('payoutSelectAll');
    if (all) all.checked = false;
    _updatePayoutBulkBar();
};

window.processSelectedPayouts = async function() {
    var ids = [..._payoutSelectedIds];
    if (!ids.length) { toast('Select at least one booking.', 'warning'); return; }
    if (!confirm('Initiate payouts for ' + ids.length + ' booking(s)? Owners will be notified by email.')) return;
    toast('Processing payouts...', 'info');
    try {
        var sessionResult = await _supabase.auth.getSession();
        var session = sessionResult.data.session;
        var res = await fetch('https://xuxzeinufjpplxkerlsd.supabase.co/functions/v1/process-payouts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token },
            body: JSON.stringify({ booking_ids: ids, notes: 'Admin initiated payout' }),
        });
        var result = await res.json();
        if (result.success) {
            toast('Payouts initiated for ' + result.processed + ' booking(s). Owners notified.', 'success');
            window.clearPayoutSelection();
            setTimeout(window.loadPayoutsTable, 600);
        } else { toast('Error: ' + (result.error || 'Unknown'), 'error'); }
    } catch(err) { toast('Failed: ' + err.message, 'error'); }
};

window.markSelectedPayoutsPaid = async function() {
    var ids = [..._payoutSelectedIds];
    if (!ids.length) { toast('Select at least one booking.', 'warning'); return; }
    if (!confirm('Mark ' + ids.length + ' payout(s) as PAID? This confirms money was transferred.')) return;
    toast('Marking as paid...', 'info');
    try {
        var sessionResult = await _supabase.auth.getSession();
        var session = sessionResult.data.session;
        var res = await fetch('https://xuxzeinufjpplxkerlsd.supabase.co/functions/v1/process-payouts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token },
            body: JSON.stringify({ booking_ids: ids, action: 'mark_paid' }),
        });
        var result = await res.json();
        if (result.success) {
            toast('Marked as paid. Owners notified.', 'success');
            window.clearPayoutSelection();
            setTimeout(window.loadPayoutsTable, 600);
        } else { toast('Error: ' + (result.error || 'Unknown'), 'error'); }
    } catch(err) { toast('Failed: ' + err.message, 'error'); }
};

window.exportPayoutsCSV = function(filter) {
    var source = filter === 'pending'    ? _payoutAllRows.filter(function(r) { return !r.payout_status; })
               : filter === 'paid'       ? _payoutAllRows.filter(function(r) { return r.payout_status === 'paid'; })
               : filter === 'processing' ? _payoutAllRows.filter(function(r) { return r.payout_status === 'processing'; })
               : _payoutAllRows;
    if (!source.length) { toast('No data to export.', 'warning'); return; }
    var headers = 'Booking ID,Guest,Guest Phone,Listing,Nights,Unit Price (RWF),Total (RWF),Owner,Owner Phone,Payout Status';
    var rows = source.map(function(r) {
        var owner = r.listings && r.listings.profiles;
        return [
            (r.booking_reference||r.id.slice(0,8)).toUpperCase(),
            r.guest_name||'', r.guest_phone||'',
            r.listings ? r.listings.title||'' : '', r.nights||'',
            r.price_per_unit||'', r.total_amount||'',
            owner ? owner.full_name||'' : '', owner ? owner.phone||'' : '',
            r.payout_status||'Not Paid Out',
        ].map(function(v) { return '"' + String(v).replace(/"/g,'""') + '"'; }).join(',');
    });
    var csv  = headers + '\n' + rows.join('\n');
    var blob = new Blob([csv], { type: 'text/csv' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href = url; a.download = 'afristay-payouts-' + filter + '-' + new Date().toISOString().slice(0,10) + '.csv';
    a.click(); URL.revokeObjectURL(url);
};

// ═══════════════════════════════════════════════════
//  ADMIN FEEDBACK VIEWER
// ═══════════════════════════════════════════════════
window.loadFeedback = async function() {
    var container = document.getElementById('feedbackContainer');
    if (!container || !_supabase) return;
    container.innerHTML = '<p style="color:#aaa;text-align:center;padding:30px;"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading...</p>';
    var typeFilter   = document.getElementById('feedbackFilterType')   ? document.getElementById('feedbackFilterType').value   : 'all';
    var statusFilter = document.getElementById('feedbackFilterStatus') ? document.getElementById('feedbackFilterStatus').value : 'all';
    var q = _supabase.from('feedback').select('*').order('created_at',{ascending:false}).limit(100);
    if (typeFilter   !== 'all') q = q.eq('type',   typeFilter);
    if (statusFilter !== 'all') q = q.eq('status', statusFilter);
    var result = await q;
    var items = result.data, error = result.error;
    if (error) { container.innerHTML = '<p style="color:#e74c3c;text-align:center;padding:20px;">' + error.message + '</p>'; return; }
    var newCount = (items||[]).filter(function(i) { return i.status === 'new'; }).length;
    var badge    = document.getElementById('badge-feedback');
    if (badge) { badge.textContent = newCount; badge.style.display = newCount ? '' : 'none'; }
    if (!items || !items.length) { container.innerHTML = '<p style="color:#bbb;text-align:center;padding:30px;">No feedback yet.</p>'; return; }
    var typeIcon  = { bug:'fa-bug', suggestion:'fa-lightbulb', confusion:'fa-circle-question', other:'fa-comment' };
    var typeColor = { bug:'#e74c3c', suggestion:'#27ae60', confusion:'#3b82f6', other:'#888' };
    var stColor   = { new:'#EB6753', reviewed:'#c47f2a', resolved:'#27ae60' };
    container.innerHTML = items.map(function(item) {
        var ic  = typeIcon[item.type]  || 'fa-comment';
        var clr = typeColor[item.type] || '#888';
        var sc  = stColor[item.status] || '#aaa';
        var dt  = new Date(item.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
        var desc = (item.description||'').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        return '<div style="padding:16px 0;border-bottom:1px solid #f5f5f5;display:grid;grid-template-columns:auto 1fr auto;gap:14px;align-items:start;">' +
            '<div style="width:40px;height:40px;border-radius:12px;background:' + clr + '22;display:flex;align-items:center;justify-content:center;font-size:18px;color:' + clr + ';flex-shrink:0;"><i class="fa-solid ' + ic + '"></i></div>' +
            '<div><div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap;">' +
            '<span style="font-size:11px;font-weight:700;text-transform:uppercase;color:' + clr + ';">' + item.type + '</span>' +
            (item.user_name  ? '<span style="font-size:12px;color:#888;">· ' + item.user_name + '</span>' : '') +
            (item.user_email ? '<span style="font-size:12px;color:#aaa;">(' + item.user_email + ')</span>' : '') +
            '<span style="font-size:11px;color:#ccc;">' + dt + '</span></div>' +
            '<p style="margin:0 0 6px;font-size:13px;color:#1a1a1a;line-height:1.6;">' + desc + '</p>' +
            (item.page_url ? '<p style="margin:0;font-size:11px;color:#aaa;">Page: ' + item.page_url + '</p>' : '') + '</div>' +
            '<div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end;flex-shrink:0;">' +
            '<span style="background:' + sc + '22;color:' + sc + ';padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;text-transform:uppercase;">' + item.status + '</span>' +
            '<select onchange="updateFeedbackStatus(\'' + item.id + '\',this.value)" style="padding:4px 8px;border:1.5px solid #ebebeb;border-radius:8px;font-size:11px;font-family:Inter,sans-serif;outline:none;cursor:pointer;color:#555;">' +
            '<option value="new"'      + (item.status==='new'      ? ' selected' : '') + '>New</option>' +
            '<option value="reviewed"' + (item.status==='reviewed' ? ' selected' : '') + '>Reviewed</option>' +
            '<option value="resolved"' + (item.status==='resolved' ? ' selected' : '') + '>Resolved</option>' +
            '</select></div></div>';
    }).join('');
};

window.updateFeedbackStatus = async function(id, status) {
    await _supabase.from('feedback').update({ status: status }).eq('id', id);
    toast('Status updated', 'success');
    setTimeout(window.loadFeedback, 400);
};
