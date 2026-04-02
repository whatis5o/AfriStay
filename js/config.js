/**
 * AFRI-STAY GLOBAL CONFIG
 * Fill SUPABASE_URL and SUPABASE_KEY (anon public key).
 * Do NOT put service_role key here.
 */

console.log("🚀 [CONFIG] Loading AfriStay configuration...");

const CONFIG = {
    APP_NAME: "AfriStay Admin",
    CURRENCY: "RWF",
    MOBILE_BREAKPOINT: 900,
    ANIMATION_SPEED: 300,
    SITE_URL: "https://afristay.rw",

    // === REPLACE THESE with values from Supabase Settings -> API ===
    SUPABASE_URL: "https://xuxzeinufjpplxkerlsd.supabase.co", // Your project URL
    SUPABASE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1eHplaW51ZmpwcGx4a2VybHNkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3NDQ0OTAsImV4cCI6MjA4NjMyMDQ5MH0.u8D-VZ98wBX448UJXq-UugLPTFf57uq946FSQXJLgac" // REPLACE with your actual anon key
};

// Compute functions URL automatically from SUPABASE_URL
try {
    if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_URL.includes(".supabase.co")) {
        // Correct format: https://<ref>.supabase.co/functions/v1
        CONFIG.FUNCTIONS_BASE = CONFIG.SUPABASE_URL + '/functions/v1';
        console.log("✅ [CONFIG] Functions URL computed:", CONFIG.FUNCTIONS_BASE);
    } else {
        CONFIG.FUNCTIONS_BASE = "";
        console.warn("⚠️ [CONFIG] No valid Supabase URL found for functions");
    }
} catch (e) {
    CONFIG.FUNCTIONS_BASE = "";
    console.error("❌ [CONFIG] Error computing functions URL:", e);
}

console.log("📋 [CONFIG] App Name:", CONFIG.APP_NAME);
console.log("💰 [CONFIG] Currency:", CONFIG.CURRENCY);

// Create a global supabase client
if (typeof window !== "undefined") {
    console.log("🔍 [CONFIG] Checking for Supabase library...");
    
    // Check if Supabase library is loaded
    if (typeof window.supabase === "undefined") {
        console.error("❌ [CONFIG] Supabase library not found! Make sure you include the Supabase CDN script in your HTML:");
        console.error("Add this before config.js: <script src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'></script>");
    } else if (typeof window.supabase.createClient !== "function") {
        console.error("❌ [CONFIG] window.supabase exists but createClient is not a function");
        console.error("Current window.supabase:", window.supabase);
    } else {
        // Proper way: window.supabase is the library, we create a client from it
        try {
            if (!CONFIG.SUPABASE_URL || CONFIG.SUPABASE_KEY.includes("public-anon-key")) {
                console.error("❌ [CONFIG] Invalid Supabase configuration! Please set SUPABASE_URL and SUPABASE_KEY in config.js");
                console.error("Current SUPABASE_URL:", CONFIG.SUPABASE_URL);
                console.error("Current SUPABASE_KEY:", CONFIG.SUPABASE_KEY?.substring(0, 20) + "...");
            } else {
                // Create the client and store it
                window.supabaseClient = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
                console.log("✅ [CONFIG] Supabase client created successfully!");
                console.log("🔗 [CONFIG] Connected to:", CONFIG.SUPABASE_URL);
                
                // Test the connection
                window.supabaseClient.from('profiles').select('count', { count: 'exact', head: true })
                    .then(({ count, error }) => {
                        if (error) {
                            console.error("❌ [CONFIG] Connection test failed:", error.message);
                        } else {
                            console.log("✅ [CONFIG] Connection test successful! Profile count:", count);
                        }
                    });
            }
        } catch (error) {
            console.error("❌ [CONFIG] Error creating Supabase client:", error);
        }
    }
}

console.log("✨ [CONFIG] Configuration complete");