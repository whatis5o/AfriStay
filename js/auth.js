// auth.js — AfriStay v2 (Email OR Phone Login, Phone OTP on Signup only)
(function () {
    const toggleSignin    = document.getElementById('btn-signin');
    const toggleSignup    = document.getElementById('btn-signup');
    const authToggleCont  = document.getElementById('authToggleContainer');
    
    const loginGroup      = document.getElementById('loginGroup');
    const signupGroup     = document.getElementById('signupGroup');
    const otpGroup        = document.getElementById('otpGroup');
    const passwordGroup   = document.getElementById('passwordGroup');
    
    const authForm        = document.getElementById('authForm');
    const authError       = document.getElementById('authError');
    const authSuccess     = document.getElementById('authSuccess');
    const formTitle       = document.getElementById('dynamicTitle');
    const submitBtn       = document.getElementById('submitBtn');

    let mode = 'signin'; // 'signin', 'signup', or 'verify_otp'

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

        // Reset visibility
        loginGroup.classList.add('hidden');
        signupGroup.classList.add('hidden');
        otpGroup.classList.add('hidden');
        passwordGroup.classList.remove('hidden');
        authToggleCont.classList.remove('hidden');

        toggleSignin.classList.remove('active');
        toggleSignup.classList.remove('active');

        if (mode === 'signup') {
            toggleSignup.classList.add('active');
            signupGroup.classList.remove('hidden');
            formTitle.innerText = 'Sign Up';
            submitBtn.innerText = 'Create Account';
        } else if (mode === 'verify_otp') {
            // Special state triggered during phone signup
            authToggleCont.classList.add('hidden');
            passwordGroup.classList.add('hidden');
            otpGroup.classList.remove('hidden');
            formTitle.innerText = 'Verify Phone';
            submitBtn.innerText = 'Verify & Login';
        } else {
            // Default: Sign In
            toggleSignin.classList.add('active');
            loginGroup.classList.remove('hidden');
            formTitle.innerText = 'Sign In';
            submitBtn.innerText = 'Login';
        }
    };

    toggleAuth('signin');

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
        setTimeout(() => {
            window.location.href = (role === 'admin' || role === 'owner') ? '/Dashboard' : '/';
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

                // If successful, Supabase automatically establishes a session
                await handleSuccessfulLogin(client, data.user);
            }

        } catch (err) {
            console.error('Auth error', err);
            showError('Something went wrong. Please try again.');
            submitBtn.innerText = mode === 'signup' ? 'Create Account' : (mode === 'verify_otp' ? 'Verify & Login' : 'Login');
        }
    });

    // Enter key support
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && document.activeElement?.form === authForm) {
            authForm.requestSubmit();
        }
    });
})();