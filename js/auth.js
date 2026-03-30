// auth.js — AfriStay v2 (Email OR Phone Login, Phone OTP on Signup only)
(function () {
    const toggleSignin    = document.getElementById('btn-signin');
    const toggleSignup    = document.getElementById('btn-signup');
    const authToggleCont  = document.getElementById('authToggleContainer');
    
    const loginGroup      = document.getElementById('loginGroup');
    const signupGroup     = document.getElementById('signupGroup');
    const otpGroup        = document.getElementById('otpGroup');
    const passwordGroup   = document.getElementById('passwordGroup');
    const forgotGroup     = document.getElementById('forgotGroup');
    const resetGroup      = document.getElementById('resetGroup');
    const forgotLink      = document.getElementById('forgotLink');

    const authForm        = document.getElementById('authForm');
    const authError       = document.getElementById('authError');
    const authSuccess     = document.getElementById('authSuccess');
    const formTitle       = document.getElementById('dynamicTitle');
    const submitBtn       = document.getElementById('submitBtn');

    let mode = 'signin'; // 'signin', 'signup', 'verify_otp', 'forgot', 'reset'

    function showError(msg) {
        if (authError)   { authError.style.display = 'block'; authError.innerText = msg; }
        if (authSuccess) { authSuccess.style.display = 'none'; authSuccess.innerText = ''; }
    }
    function showSuccess(msg) {
        if (authSuccess) { authSuccess.style.display = 'block'; authSuccess.innerText = msg; }
        if (authError)   { authError.style.display = 'none'; authError.innerText = ''; }
    }

    window.toggleAuth = (m) => {
        mode = m;
        showError('');
        showSuccess('');

        // Reset all groups
        loginGroup.classList.add('hidden');
        signupGroup.classList.add('hidden');
        otpGroup.classList.add('hidden');
        forgotGroup.classList.add('hidden');
        resetGroup.classList.add('hidden');
        passwordGroup.classList.remove('hidden');
        authToggleCont.classList.remove('hidden');
        if (forgotLink) forgotLink.style.display = 'none';

        toggleSignin.classList.remove('active');
        toggleSignup.classList.remove('active');

        if (mode === 'signup') {
            toggleSignup.classList.add('active');
            signupGroup.classList.remove('hidden');
            formTitle.innerText = 'Sign Up';
            submitBtn.innerText = 'Create Account';
        } else if (mode === 'verify_otp') {
            authToggleCont.classList.add('hidden');
            passwordGroup.classList.add('hidden');
            otpGroup.classList.remove('hidden');
            formTitle.innerText = 'Verify Phone';
            submitBtn.innerText = 'Verify & Login';
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
        // Fetch profile — including banned flag
        const { data: profile, error: pErr } = await client
            .from('profiles')
            .select('full_name, role, banned, email')
            .eq('id', user.id)
            .single();

        if (pErr) { showError('Could not load your profile.'); return; }

        // ── BAN CHECK ──
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
        const dest = role === 'admin' ? '/Dashboards/Admin/' : role === 'owner' ? '/Dashboards/Owner/' : '/';
        setTimeout(() => {
            window.location.href = dest;
        }, 1000);
    }

    authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        showError(''); showSuccess('');

        const client = window.supabaseClient;
        if (!client) { showError('Supabase not configured'); return; }

        try {
            if (mode === 'signin') {
                // ── LOG IN FLOW (Auto-detect Email vs Phone) ──
                const identifier = document.getElementById('loginIdentifier')?.value?.trim();
                const password   = document.getElementById('password')?.value;

                if (!identifier || !password) { showError('Please enter your credentials'); return; }

                submitBtn.innerText = 'Logging in...';
                let authResponse;

                if (identifier.includes('@')) {
                    // It's an Email
                    authResponse = await client.auth.signInWithPassword({ email: identifier, password });
                } else {
                    // It's a Phone Number (Ensure it has a +)
                    let formattedPhone = identifier.startsWith('+') ? identifier : '+' + identifier;
                    authResponse = await client.auth.signInWithPassword({ phone: formattedPhone, password });
                }

                if (authResponse.error) { 
                    showError(authResponse.error.message || 'Sign in failed'); 
                    submitBtn.innerText = 'Login';
                    return; 
                }

                await handleSuccessfulLogin(client, authResponse.data.user);

            } else if (mode === 'signup') {
                // ── SIGN UP FLOW ──
                const fullName = document.getElementById('fullName')?.value?.trim();
                const email    = document.getElementById('signupEmail')?.value?.trim();
                let phone      = document.getElementById('signupPhone')?.value?.trim();
                const password = document.getElementById('password')?.value;

                if (!password) { showError('Password is required'); return; }
                if (!email && !phone) { showError('Please provide an email or phone number'); return; }

                submitBtn.innerText = 'Creating Account...';

                // If they provided a phone, prioritize phone signup so we can send the OTP
                if (phone) {
                    phone = phone.startsWith('+') ? phone : '+' + phone;
                    
                    const { data, error } = await client.auth.signUp({
                        phone,
                        password,
                        options: { data: { full_name: fullName || null, custom_email: email || null } }
                    });

                    if (error) { 
                        showError(error.message || 'Phone sign up failed'); 
                        submitBtn.innerText = 'Create Account';
                        return; 
                    }

                    // Success! Supabase just sent an OTP. Move to Verify step.
                    toggleAuth('verify_otp');

                } else {
                    // Email only signup
                    const { data, error } = await client.auth.signUp({
                        email,
                        password,
                        options: { data: { full_name: fullName || null } }
                    });

                    if (error) { 
                        showError(error.message || 'Email sign up failed'); 
                        submitBtn.innerText = 'Create Account';
                        return; 
                    }
                    showSuccess('Sign up successful! Please check your email to confirm, then sign in.');
                    submitBtn.innerText = 'Create Account';
                }

            } else if (mode === 'verify_otp') {
                // ── OTP VERIFICATION FLOW (Post-Phone Signup) ──
                let phone = document.getElementById('signupPhone')?.value?.trim();
                phone = phone.startsWith('+') ? phone : '+' + phone;
                const token = document.getElementById('otpCode')?.value?.trim();

                if (!token) { showError('Please enter the 6-digit code'); return; }

                submitBtn.innerText = 'Verifying...';

                const { data, error } = await client.auth.verifyOtp({
                    phone,
                    token,
                    type: 'sms'
                });

                if (error) {
                    showError(error.message || 'Invalid code. Try again.');
                    submitBtn.innerText = 'Verify & Login';
                    return;
                }

                await handleSuccessfulLogin(client, data.user);

            } else if (mode === 'forgot') {
                // ── FORGOT PASSWORD: send reset email ──
                const email = document.getElementById('forgotEmail')?.value?.trim();
                if (!email) { showError('Please enter your email address'); return; }

                submitBtn.innerText = 'Sending...';

                const { error } = await client.auth.resetPasswordForEmail(email, {
                    redirectTo: window.location.origin + '/Auth/'
                });

                submitBtn.innerText = 'Send Reset Link';

                if (error) { showError(error.message || 'Could not send reset email'); return; }

                showSuccess('Check your inbox — we sent a password reset link.');

            } else if (mode === 'reset') {
                // ── RESET PASSWORD: set new password ──
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
            const btnLabels = { signup: 'Create Account', verify_otp: 'Verify & Login', forgot: 'Send Reset Link', reset: 'Save New Password' };
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