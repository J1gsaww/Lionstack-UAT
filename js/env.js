/* ============================================================================
 * Environment switch — loads FIRST, before anything else.
 *
 * Decides whether this page runs on localStorage or on Firebase, and which
 * Firebase project it talks to. Keeping the decision here (rather than editing
 * a config before every deploy) means the SAME build can be pushed to the UAT
 * repo and the production repo without touching a file — the hostname decides.
 *
 * window.APP_MODE        'local' | 'firebase'
 * window.FIREBASE_CONFIG the project config for this host
 * window.APP_ENV         'local' | 'uat' | 'prod'   (shown in the UI, handy)
 *
 * NOTE ON THE API KEY: a Firebase web apiKey is not a secret — it only names
 * the project. What protects the data is Firestore Security Rules plus sign-in.
 * ==========================================================================*/
(function(){
  // ---- UAT project (lionstack-17e94) ----
  const UAT = {
    apiKey: "AIzaSyCFIvx4m-OksRMVQOg95fwPgPmzdEP4F-8",
    authDomain: "lionstack-17e94.firebaseapp.com",
    projectId: "lionstack-17e94",
    storageBucket: "lionstack-17e94.firebasestorage.app",
    messagingSenderId: "620776124334",
    appId: "1:620776124334:web:6b8a38d1f3e9590e50223f",
    measurementId: "G-1YEH2PYL4P"
  };

  // ---- Production project: create a SECOND Firebase project and paste it here.
  // Until then production keeps running on localStorage, which is safer than
  // sharing UAT's database with real customer data.
  const PROD = null;

  const host = (location.hostname || '').toLowerCase();
  const path = (location.pathname || '').toLowerCase();

  // Anything served from a real domain/GitHub Pages counts as deployed; a file://
  // or 127.0.0.1 / localhost page is a developer's machine.
  const isLocalHost = !host || host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.') || location.protocol === 'file:';

  // UAT is either the -uat repo path or a uat.* subdomain.
  const looksUat = path.includes('lionstack-uat') || host.startsWith('uat.');

  let env = 'local', cfg = null;
  if(!isLocalHost){
    if(looksUat){ env = 'uat'; cfg = UAT; }
    else if(PROD){ env = 'prod'; cfg = PROD; }
    else { env = 'prod'; cfg = null; }         // prod not configured yet → local storage
  }

  // Flip this to true while developing against UAT from your own machine.
  const FORCE_FIREBASE_ON_LOCALHOST = false;
  if(isLocalHost && FORCE_FIREBASE_ON_LOCALHOST){ env = 'uat'; cfg = UAT; }

  window.APP_ENV = env;
  window.FIREBASE_CONFIG = cfg;
  window.APP_MODE = cfg ? 'firebase' : 'local';

  console.info('[env] mode=' + window.APP_MODE + ' env=' + env + (cfg ? ' project=' + cfg.projectId : ''));
})();
