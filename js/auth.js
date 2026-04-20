// auth.js — AfriStay (Email-only login & signup)
(function () {
    // Capture URL params immediately — Supabase clears the hash after token exchange
    const _initSearch = new URLSearchParams(window.location.search);
    const _initHash   = new URLSearchParams(window.location.hash.replace('#', ''));
    const _initType   = _initSearch.get('type') || _initHash.get('type');
    const _initCode   = _initSearch.get('code');
    const _isAuthCallback = _initType === 'invite' || _initType === 'magiclink' || !!_initCode || !!_initHash.get('access_token');

    const toggleSignin    = document.getElementById('btn-signin');
    const toggleSignup    = document.getElementById('btn-signup');
    const authToggleCont  = document.getElementById('authToggleContainer');

    const loginGroup      = document.getElementById('loginGroup');
    const signupGroup     = document.getElementById('signupGroup');
    const passwordGroup   = document.getElementById('passwordGroup');
    const forgotGroup     = document.getElementById('forgotGroup');
    const resetGroup      = document.getElementById('resetGroup');
    const setupGroup      = document.getElementById('setupGroup');
    const forgotLink      = document.getElementById('forgotLink');

    const authForm        = document.getElementById('authForm');
    const authError       = document.getElementById('authError');
    const authSuccess     = document.getElementById('authSuccess');
    const formTitle       = document.getElementById('dynamicTitle');
    const submitBtn       = document.getElementById('submitBtn');

    let mode = 'signin';

    function isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
    }

    // Show banned message if redirected here from a suspended-account block
    if (new URLSearchParams(window.location.search).get('error') === 'banned') {
        showError('Your account has been suspended. Contact support if you believe this is a mistake.');
    }

    function showError(msg, isHtml) {
        if (authError) {
            authError.style.display = msg ? 'block' : 'none';
            if (isHtml) authError.innerHTML = msg;
            else authError.innerText = msg;
        }
        if (authSuccess) { authSuccess.style.display = 'none'; authSuccess.innerText = ''; }
    }
    function showSuccess(msg) {
        if (authSuccess) { authSuccess.style.display = msg ? 'block' : 'none'; authSuccess.innerText = msg; }
        if (authError)   { authError.style.display = 'none'; authError.innerText = ''; }
    }

    // Eye toggle for password fields
    window._togglePwVisibility = function(inputId, btn) {
        const input = document.getElementById(inputId);
        if (!input) return;
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.innerHTML = show
            ? '<i class="fa-regular fa-eye-slash"></i>'
            : '<i class="fa-regular fa-eye"></i>';
    };

    window.toggleAuth = (m) => {
        mode = m;
        showError('');
        showSuccess('');

        loginGroup.classList.add('hidden');
        signupGroup.classList.add('hidden');
        forgotGroup.classList.add('hidden');
        resetGroup.classList.add('hidden');
        passwordGroup.classList.remove('hidden');
        authToggleCont.classList.remove('hidden');
        if (forgotLink) forgotLink.style.display = 'none';

        toggleSignin.classList.remove('active');
        toggleSignup.classList.remove('active');

        const termsNote = document.getElementById('termsNote');
        if (termsNote) termsNote.style.display = (mode === 'signup') ? 'block' : 'none';

        if (setupGroup) setupGroup.classList.add('hidden');

        if (mode === 'signup') {
            toggleSignup.classList.add('active');
            signupGroup.classList.remove('hidden');
            formTitle.innerText = 'Sign Up';
            submitBtn.innerText = 'Create Account';
        } else if (mode === 'forgot') {
            authToggleCont.classList.add('hidden');
            passwordGroup.classList.add('hidden');
            forgotGroup.classList.remove('hidden');
            formTitle.innerText = 'Reset Password';
            submitBtn.innerText = 'Send Reset Link';
        } else if (mode === 'reset') {
            authToggleCont.classList.add('hidden');
            passwordGroup.classList.add('hidden');
            resetGroup.classList.remove('hidden');
            formTitle.innerText = 'New Password';
            submitBtn.innerText = 'Save New Password';
        } else if (mode === 'setup') {
            authToggleCont.classList.add('hidden');
            passwordGroup.classList.add('hidden');
            if (setupGroup) setupGroup.classList.remove('hidden');
            formTitle.innerText = 'Complete Your Profile';
            submitBtn.innerText = 'Save & Continue';
        } else {
            toggleSignin.classList.add('active');
            loginGroup.classList.remove('hidden');
            if (forgotLink) forgotLink.style.display = 'block';
            formTitle.innerText = 'Sign In';
            submitBtn.innerText = 'Login';
        }
    };

    toggleAuth('signin');

    (function waitForSupabase() {
        const client = window.supabaseClient;
        if (!client) { setTimeout(waitForSupabase, 100); return; }

        // Check session immediately — token may already be exchanged before listener attaches
        if (_isAuthCallback) {
            client.auth.getSession().then(({ data: { session } }) => {
                if (session) toggleAuth('setup');
            });
        }

        client.auth.onAuthStateChange(async (event, session) => {
            if (event === 'PASSWORD_RECOVERY') { toggleAuth('reset'); return; }
            if (event === 'SIGNED_IN' && session && _isAuthCallback) {
                toggleAuth('setup');
            }
        });
    })();

    async function handleSuccessfulLogin(client, user) {
        let { data: profile, error: pErr } = await client
            .from('profiles')
            .select('full_name, role, banned, email')
            .eq('id', user.id)
            .maybeSingle();

        // Profile missing — trigger didn't fire at signup, create it now (INSERT only, never overwrite existing role)
        if (!profile && !pErr) {
            const { data: newProfile, error: insertErr } = await client
                .from('profiles')
                .insert({
                    id:        user.id,
                    email:     user.email,
                    full_name: user.user_metadata?.full_name || '',
                    role:      'user',
                })
                .select('full_name, role, banned, email')
                .maybeSingle();
            if (insertErr) { showError('Could not set up your profile. Please contact support.'); return; }
            profile = newProfile;
        }

        if (pErr) { showError('Could not load your profile. Please try again.'); return; }

        if (profile?.banned === true) {
            await client.auth.signOut();
            const { data: admins } = await client
                .from('profiles')
                .select('email')
                .eq('role', 'admin')
                .limit(1);
            const adminEmail = admins?.[0]?.email || 'support@afristay.rw';
            showError('Your account has been suspended. Contact ' + adminEmail + ' to appeal.');
            return;
        }

        const role      = profile?.role || 'user';
        const firstName = (profile?.full_name || 'User').split(' ')[0];

        localStorage.setItem('afriStay_role', role);
        localStorage.setItem('afriStay_firstName', firstName);

        // Go back to where they were — ?redirect= param, then referrer, then home
        const params   = new URLSearchParams(window.location.search);
        const redirect = params.get('redirect');
        const referrer = document.referrer;
        const siteOrigin = (typeof CONFIG !== 'undefined' && CONFIG.SITE_URL) ? CONFIG.SITE_URL : window.location.origin;
        let dest = '/';
        if (redirect && redirect.startsWith('/')) {
            dest = redirect;
        } else if (referrer && referrer.startsWith(siteOrigin) && !referrer.includes('/Auth/')) {
            dest = referrer.replace(siteOrigin, '');
        }
        showSuccess('Welcome back, ' + firstName + '! Redirecting...');
        setTimeout(() => { window.location.href = dest; }, 1000);
    }

    authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        showError(''); showSuccess('');

        const client = window.supabaseClient;
        if (!client) { showError('Supabase not configured'); return; }

        try {
            if (mode === 'signin') {
                const email    = document.getElementById('loginEmail')?.value?.trim();
                const password = document.getElementById('password')?.value;

                if (!email)              { showError('Please enter your email address.'); return; }
                if (!isValidEmail(email)){ showError('Please enter a valid email address (e.g. name@example.com).'); return; }
                if (!password)           { showError('Please enter your password.'); return; }

                submitBtn.innerText = 'Logging in...';
                const { data, error } = await client.auth.signInWithPassword({ email, password });

                if (error) {
                    if (error.message?.toLowerCase().includes('invalid login') ||
                        error.message?.toLowerCase().includes('invalid credentials')) {
                        showError('Incorrect email or password. Please try again.');
                    } else {
                        showError(error.message || 'Sign in failed.');
                    }
                    submitBtn.innerText = 'Login';
                    return;
                }

                await handleSuccessfulLogin(client, data.user);

            } else if (mode === 'signup') {
                const fullName = document.getElementById('fullName')?.value?.trim();
                const email    = document.getElementById('signupEmail')?.value?.trim();
                const password = document.getElementById('password')?.value;

                if (!fullName)           { showError('Please enter your full name.'); return; }
                if (!email)              { showError('Please enter your email address.'); return; }
                if (!isValidEmail(email)){ showError('Please enter a valid email address (e.g. name@example.com).'); return; }
                if (!password)           { showError('Please choose a password.'); return; }
                if (password.length < 6) { showError('Password must be at least 6 characters.'); return; }

                submitBtn.innerText = 'Creating Account...';

                const { error } = await client.auth.signUp({
                    email,
                    password,
                    options: { data: { full_name: fullName } }
                });

                if (error) {
                    const msg = error.message || '';
                    const msgLow = msg.toLowerCase();
                    if (msgLow.includes('already registered') || msgLow.includes('already exists')) {
                        showError(
                            'An account with this email already exists. ' +
                            '<a href="#" onclick="window.toggleAuth(\'signin\');return false;" ' +
                            'style="color:#EB6753;font-weight:700;text-decoration:none;">Sign in instead?</a>',
                            true
                        );
                    } else if (msgLow.includes('rate limit') || msgLow.includes('too many') || error.status === 429) {
                        showError('Too many attempts. Please wait a few minutes and try again.');
                    } else if (error.status === 422) {
                        showError('We couldn\'t create your account right now. Please wait a few minutes and try again, or contact support.');
                    } else {
                        showError(msg || 'Sign up failed. Please try again.');
                    }
                    submitBtn.innerText = 'Create Account';
                    return;
                }

                showSuccess('Account created! Check your email to confirm, then sign in.');
                submitBtn.innerText = 'Create Account';

            } else if (mode === 'forgot') {
                const email = document.getElementById('forgotEmail')?.value?.trim();
                if (!email)              { showError('Please enter your email address.'); return; }
                if (!isValidEmail(email)){ showError('Please enter a valid email address (e.g. name@example.com).'); return; }

                submitBtn.innerText = 'Sending...';

                const { error } = await client.auth.resetPasswordForEmail(email, {
                    redirectTo: (typeof CONFIG !== 'undefined' && CONFIG.SITE_URL ? CONFIG.SITE_URL : window.location.origin) + '/Auth/'
                });

                submitBtn.innerText = 'Send Reset Link';
                if (error) { showError(error.message || 'Could not send reset email.'); return; }
                showSuccess('Check your inbox — we sent a password reset link.');

            } else if (mode === 'setup') {
                const name     = document.getElementById('setupName')?.value?.trim();
                const phone    = document.getElementById('setupPhone')?.value?.trim();
                const cc       = document.getElementById('setupCountryCode')?.value || '+250';
                const newPwd   = document.getElementById('setupPassword')?.value;
                const confPwd  = document.getElementById('setupConfirmPassword')?.value;

                if (!name)                       { showError('Please enter your full name.'); return; }
                if (!phone)                      { showError('Please enter your phone number.'); return; }
                if (!newPwd || newPwd.length < 6){ showError('Password must be at least 6 characters.'); return; }
                if (newPwd !== confPwd)          { showError('Passwords do not match.'); return; }

                submitBtn.innerText = 'Saving...';

                const { data: { user }, error: pwErr } = await client.auth.updateUser({ password: newPwd });
                if (pwErr) { showError(pwErr.message || 'Could not set password.'); submitBtn.innerText = 'Save & Continue'; return; }

                const { error: profileErr } = await client
                    .from('profiles')
                    .upsert({
                        id: user.id,
                        full_name: name,
                        phone: cc + phone,
                        country_code: cc,
                        email: user.email,
                        updated_at: new Date().toISOString(),
                    }, { onConflict: 'id' });

                if (profileErr) { showError('Profile could not be saved. Please try again.'); submitBtn.innerText = 'Save & Continue'; return; }

                await handleSuccessfulLogin(client, user);

            } else if (mode === 'reset') {
                const newPwd  = document.getElementById('newPassword')?.value;
                const confPwd = document.getElementById('confirmPassword')?.value;

                if (!newPwd || newPwd.length < 6) { showError('Password must be at least 6 characters.'); return; }
                if (newPwd !== confPwd) { showError('Passwords do not match.'); return; }

                submitBtn.innerText = 'Saving...';

                const { error } = await client.auth.updateUser({ password: newPwd });

                if (error) {
                    showError(error.message || 'Could not update password.');
                    submitBtn.innerText = 'Save New Password';
                    return;
                }

                showSuccess('Password updated! Signing you in...');
                await client.auth.signOut();
                setTimeout(() => { toggleAuth('signin'); }, 1800);
            }

        } catch (err) {
            console.error('Auth error', err);
            showError('Something went wrong. Please try again.');
            const btnLabels = { signup: 'Create Account', forgot: 'Send Reset Link', reset: 'Save New Password' };
            submitBtn.innerText = btnLabels[mode] || 'Login';
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && document.activeElement?.form === authForm) {
            authForm.requestSubmit();
        }
    });
})();
