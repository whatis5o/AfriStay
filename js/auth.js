// auth.js — AfriStay (Email-only login & signup)
(function () {
    const toggleSignin    = document.getElementById('btn-signin');
    const toggleSignup    = document.getElementById('btn-signup');
    const authToggleCont  = document.getElementById('authToggleContainer');

    const loginGroup      = document.getElementById('loginGroup');
    const signupGroup     = document.getElementById('signupGroup');
    const passwordGroup   = document.getElementById('passwordGroup');
    const forgotGroup     = document.getElementById('forgotGroup');
    const resetGroup      = document.getElementById('resetGroup');
    const forgotLink      = document.getElementById('forgotLink');

    const authForm        = document.getElementById('authForm');
    const authError       = document.getElementById('authError');
    const authSuccess     = document.getElementById('authSuccess');
    const formTitle       = document.getElementById('dynamicTitle');
    const submitBtn       = document.getElementById('submitBtn');

    let mode = 'signin'; // 'signin', 'signup', 'forgot', 'reset'

    // Show banned message if redirected here from a suspended-account block
    if (new URLSearchParams(window.location.search).get('error') === 'banned') {
        showError('Your account has been suspended. Contact support if you believe this is a mistake.');
    }

    function showError(msg) {
        if (authError)   { authError.style.display = msg ? 'block' : 'none'; authError.innerText = msg; }
        if (authSuccess) { authSuccess.style.display = 'none'; authSuccess.innerText = ''; }
    }
    function showSuccess(msg) {
        if (authSuccess) { authSuccess.style.display = msg ? 'block' : 'none'; authSuccess.innerText = msg; }
        if (authError)   { authError.style.display = 'none'; authError.innerText = ''; }
    }

    window.toggleAuth = (m) => {
        mode = m;
        showError('');
        showSuccess('');

        // Reset all groups
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
        } else {
            // Default: Sign In
            toggleSignin.classList.add('active');
            loginGroup.classList.remove('hidden');
            if (forgotLink) forgotLink.style.display = 'block';
            formTitle.innerText = 'Sign In';
            submitBtn.innerText = 'Login';
        }
    };

    toggleAuth('signin');

    // Auto-trigger reset mode when user lands via password-reset email link
    (function waitForSupabase() {
        const client = window.supabaseClient;
        if (!client) { setTimeout(waitForSupabase, 100); return; }
        client.auth.onAuthStateChange((event) => {
            if (event === 'PASSWORD_RECOVERY') toggleAuth('reset');
        });
    })();

    async function handleSuccessfulLogin(client, user) {
        const { data: profile, error: pErr } = await client
            .from('profiles')
            .select('full_name, role, banned, email')
            .eq('id', user.id)
            .single();

        if (pErr) { showError('Could not load your profile.'); return; }

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

        showSuccess('Welcome back, ' + firstName + '! Redirecting...');
        setTimeout(() => { window.location.href = '/'; }, 1000);
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

                if (!email || !password) { showError('Please enter your email and password'); return; }

                submitBtn.innerText = 'Logging in...';
                const { data, error } = await client.auth.signInWithPassword({ email, password });

                if (error) {
                    showError(error.message || 'Sign in failed');
                    submitBtn.innerText = 'Login';
                    return;
                }

                await handleSuccessfulLogin(client, data.user);

            } else if (mode === 'signup') {
                const fullName = document.getElementById('fullName')?.value?.trim();
                const email    = document.getElementById('signupEmail')?.value?.trim();
                const password = document.getElementById('password')?.value;

                if (!email)    { showError('Email address is required'); return; }
                if (!password) { showError('Password is required'); return; }

                submitBtn.innerText = 'Creating Account...';

                const { error } = await client.auth.signUp({
                    email,
                    password,
                    options: { data: { full_name: fullName || null } }
                });

                if (error) {
                    showError(error.message || 'Sign up failed');
                    submitBtn.innerText = 'Create Account';
                    return;
                }

                showSuccess('Account created! Please check your email to confirm, then sign in.');
                submitBtn.innerText = 'Create Account';

            } else if (mode === 'forgot') {
                const email = document.getElementById('forgotEmail')?.value?.trim();
                if (!email) { showError('Please enter your email address'); return; }

                submitBtn.innerText = 'Sending...';

                const { error } = await client.auth.resetPasswordForEmail(email, {
                    redirectTo: (typeof CONFIG !== 'undefined' && CONFIG.SITE_URL ? CONFIG.SITE_URL : window.location.origin) + '/Auth/'
                });

                submitBtn.innerText = 'Send Reset Link';
                if (error) { showError(error.message || 'Could not send reset email'); return; }
                showSuccess('Check your inbox — we sent a password reset link.');

            } else if (mode === 'reset') {
                const newPwd  = document.getElementById('newPassword')?.value;
                const confPwd = document.getElementById('confirmPassword')?.value;

                if (!newPwd || newPwd.length < 6) { showError('Password must be at least 6 characters'); return; }
                if (newPwd !== confPwd) { showError('Passwords do not match'); return; }

                submitBtn.innerText = 'Saving...';

                const { error } = await client.auth.updateUser({ password: newPwd });

                if (error) {
                    showError(error.message || 'Could not update password');
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

    // Enter key support
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && document.activeElement?.form === authForm) {
            authForm.requestSubmit();
        }
    });
})();
