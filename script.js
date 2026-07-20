const SUPABASE_URL = "https://goionmhlyaxtikapljes.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_m-RLzMQ-Qp23vK27JGTFHg_cX2skEmz";

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* -------------------- CLOUDFLARE TURNSTILE (bot protection) -------------------- */
const TURNSTILE_SITE_KEY = "0x4AAAAAAD4Y5yYW8B-1flNT";
let turnstileWidgets = {};

// Cloudflare calls this itself once its script has loaded (render=explicit mode).
window.onloadTurnstileCallback = function(){
  turnstileWidgets.login = turnstile.render('#turnstileLogin', { sitekey: TURNSTILE_SITE_KEY });
  turnstileWidgets.register = turnstile.render('#turnstileRegister', { sitekey: TURNSTILE_SITE_KEY });
  turnstileWidgets.resend = turnstile.render('#turnstileResend', { sitekey: TURNSTILE_SITE_KEY });
};

// Turnstile tokens are single-use — always reset right after using one,
// win or lose, so the widget is ready for the next attempt.
function getTurnstileToken(key){
  return typeof turnstile !== 'undefined' ? turnstile.getResponse(turnstileWidgets[key]) : null;
}
function resetTurnstile(key){
  if (typeof turnstile !== 'undefined' && turnstileWidgets[key] !== undefined) {
    turnstile.reset(turnstileWidgets[key]);
  }
}

/* -------------------- view helpers -------------------- */
const els = {
  authShell: document.getElementById('authShell'),
  dashboard: document.getElementById('dashboard'),
  login: document.getElementById('view-login'),
  register: document.getElementById('view-register'),
  verify: document.getElementById('view-verify'),
  stepAccount: document.getElementById('stepAccount'),
  stepVerify: document.getElementById('stepVerify'),
  stepPortal: document.getElementById('stepPortal'),
};

function showView(name){
  [els.login, els.register, els.verify].forEach(v => v.classList.add('hidden'));
  els.authShell.classList.remove('hidden');
  els.dashboard.style.display = 'none';

  els.stepAccount.classList.remove('active','done');
  els.stepVerify.classList.remove('active','done');
  els.stepPortal.classList.remove('active','done');

  if (name === 'login' || name === 'register') {
    els.stepAccount.classList.add('active');
  }
  if (name === 'verify') {
    els.stepAccount.classList.add('done');
    els.stepVerify.classList.add('active');
  }
  document.getElementById('view-' + name).classList.remove('hidden');
}

function showDashboard(){
  els.authShell.classList.add('hidden');
  els.dashboard.style.display = 'block';
  els.stepAccount.classList.add('done');
  els.stepVerify.classList.add('done');
  els.stepPortal.classList.add('active');
}

function alertBox(containerId, message, type){
  const el = document.getElementById(containerId);
  el.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
}
function clearAlert(containerId){
  document.getElementById(containerId).innerHTML = '';
}

/* -------------------- nav links between login/register -------------------- */
document.getElementById('goToRegister').addEventListener('click', (e) => {
  e.preventDefault(); clearAlert('loginAlert'); showView('register');
});
document.getElementById('goToLogin').addEventListener('click', (e) => {
  e.preventDefault(); clearAlert('registerAlert'); showView('login');
});
document.getElementById('backToLoginFromVerify').addEventListener('click', async () => {
  await sb.auth.signOut();
  clearAlert('verifyAlert');
  showView('login');
});

/* -------------------- REGISTER -------------------- */
document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAlert('registerAlert');

  const firstName = document.getElementById('regFirstName').value.trim();
  const lastName = document.getElementById('regLastName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const confirm = document.getElementById('regPasswordConfirm').value;

  if (password !== confirm) {
    alertBox('registerAlert', 'Passwords do not match.', 'error');
    return;
  }
  if (password.length < 8) {
    alertBox('registerAlert', 'Password must be at least 8 characters.', 'error');
    return;
  }

  const captchaToken = getTurnstileToken('register');
  // TEMP: Turnstile disabled for local testing — re-enable before going live.
  // if (!captchaToken) {
  //   alertBox('registerAlert', 'Please complete the security verification below before continuing', 'error');
  //   return;
  // }

  const btn = document.getElementById('registerSubmit');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Creating account…';

  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: {
      data: { first_name: firstName, last_name: lastName },
      emailRedirectTo: window.location.origin + window.location.pathname,
      captchaToken
    }
  });

  resetTurnstile('register');
  btn.disabled = false;
  btn.textContent = 'Create account';

  if (error) {
    alertBox('registerAlert', error.message, 'error');
    return;
  }

  document.getElementById('verifyEmailShown').textContent = email;
  showView('verify');
});

/* -------------------- LOGIN -------------------- */
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAlert('loginAlert');

  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  const captchaToken = getTurnstileToken('login');
  // TEMP: Turnstile disabled for local testing — re-enable before going live.
  // if (!captchaToken) {
  //   alertBox('registerAlert', 'Please complete the security verification below before continuing', 'error');
  //   return;
  // }

  const btn = document.getElementById('loginSubmit');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Logging in…';

  const { data, error } = await sb.auth.signInWithPassword({ email, password, options: { captchaToken } });

  resetTurnstile('login');
  btn.disabled = false;
  btn.textContent = 'Log in';

  if (error) {
    alertBox('loginAlert', error.message, 'error');
    return;
  }

  const user = data.user;
  if (!user.email_confirmed_at && !user.confirmed_at) {
    // Signed in, but email not verified yet — do not let them reach the dashboard.
    document.getElementById('verifyEmailShown').textContent = user.email;
    showView('verify');
    return;
  }

  await loadDashboard(user);
});

/* -------------------- VERIFY OTP CODE -------------------- */
document.getElementById('otpForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAlert('verifyAlert');

  const email = document.getElementById('verifyEmailShown').textContent;
  const token = document.getElementById('otpCode').value.trim();

  const btn = document.getElementById('otpSubmit');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Verifying…';

  const { data, error } = await sb.auth.verifyOtp({ email, token, type: 'signup' });

  btn.disabled = false;
  btn.textContent = 'Verify code';

  if (error) {
    alertBox('verifyAlert', error.message, 'error');
    return;
  }

  await loadDashboard(data.user);
});

/* -------------------- RESEND VERIFICATION (rate-limited: 2/hour) -------------------- */
document.getElementById('resendBtn').addEventListener('click', async () => {
  clearAlert('verifyAlert');
  const email = document.getElementById('verifyEmailShown').textContent;
  const btn = document.getElementById('resendBtn');

  const captchaToken = getTurnstileToken('resend');
  // TEMP: Turnstile disabled for local testing — re-enable before going live.
  // if (!captchaToken) {
  //   alertBox('registerAlert', 'Please complete the security verification below before continuing', 'error');
  //   return;
  // }

  btn.disabled = true;
  btn.textContent = 'Sending…';

  // Enforce 2 resend requests per email per rolling hour, via a
  // SECURITY DEFINER function (works even before the user has a session).
  const { data: limitCheck, error: limitError } = await sb.rpc('request_verification_resend', { p_email: email });

  if (limitError) {
    resetTurnstile('resend');
    btn.disabled = false;
    btn.textContent = 'Resend verification code';
    alertBox('verifyAlert', limitError.message, 'error');
    return;
  }

  if (!limitCheck.allowed) {
    resetTurnstile('resend');
    btn.disabled = false;
    btn.textContent = 'Resend verification code';
    alertBox('verifyAlert', limitCheck.message, 'error');
    return;
  }

  const { error } = await sb.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: window.location.origin + window.location.pathname, captchaToken }
  });

  resetTurnstile('resend');
  btn.disabled = false;
  btn.textContent = 'Resend verification code';

  if (error) {
    alertBox('verifyAlert', error.message, 'error');
  } else {
    alertBox('verifyAlert', 'Verification code resent. Check your inbox.', 'success');
  }
});

/* -------------------- SIGN OUT -------------------- */
document.getElementById('signOutBtn').addEventListener('click', async () => {
  await sb.auth.signOut();
  showView('login');
});

/* -------------------- DASHBOARD TABS (with mobile hamburger) -------------------- */
const tabsToggle = document.getElementById('tabsToggle');
const tabsList = document.getElementById('tabsList');

tabsToggle.addEventListener('click', () => {
  const isOpen = tabsList.classList.toggle('open');
  tabsToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
});

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab).classList.add('active');
    // On mobile, close the dropdown after picking a section.
    tabsList.classList.remove('open');
    tabsToggle.setAttribute('aria-expanded', 'false');
  });
});

/* -------------------- PROFILE STATE -------------------- */
let currentUser = null;
let currentProfile = null;
let profileEditMode = false;

// Everything below used to be hardcoded arrays (SCHOOL_OPTIONS, COURSE_GROUPS).
// Now it's fetched once from Supabase and cached here. To add/edit a school,
// course, major, or education level from now on: Supabase Dashboard →
// Table Editor → schools / courses / majors / education_levels.
// No code changes, no redeploy.
let LOOKUPS = { levels: [], schools: [], courses: [], majors: [] };

async function loadLookups(){
  const [levelsRes, schoolsRes, coursesRes, majorsRes] = await Promise.all([
    sb.from('education_levels').select('*').eq('active', true).order('sort_order'),
    sb.from('schools').select('*').eq('active', true).order('name'),
    sb.from('courses').select('*').eq('active', true).order('sort_order'),
    sb.from('majors').select('*').eq('active', true).order('sort_order'),
  ]);
  LOOKUPS.levels = levelsRes.data || [];
  LOOKUPS.schools = schoolsRes.data || [];
  LOOKUPS.courses = coursesRes.data || [];
  LOOKUPS.majors = majorsRes.data || [];
}

const levelById  = (id) => LOOKUPS.levels.find(l => l.id === id);
const schoolById = (id) => LOOKUPS.schools.find(s => s.id === id);
const courseById = (id) => LOOKUPS.courses.find(c => c.id === id);
const majorById  = (id) => LOOKUPS.majors.find(m => m.id === id);

const coursesForLevel = (levelId) =>
  LOOKUPS.courses.filter(c => c.level_id === levelId).sort((a,b) => a.sort_order - b.sort_order);
const majorsForCourse = (courseId) =>
  LOOKUPS.majors.filter(m => m.course_id === courseId).sort((a,b) => a.sort_order - b.sort_order);

// SHS shows "Strand", Graduate School shows "Program", everything else "Course".
function courseWrapLabel(levelCode){
  if (levelCode === 'shs') return 'Strand';
  if (levelCode === 'graduate') return 'Program';
  return 'Course';
}

function optionsHtml(list, selectedId, labelKey = 'name'){
  const opts = list.map(item =>
    `<option value="${item.id}" ${item.id === selectedId ? 'selected' : ''}>${item[labelKey]}</option>`
  ).join('');
  return `<option value="">Select…</option>${opts}`;
}

// Simple text/number fields — unchanged from before.
const EDITABLE_FIELDS = [
  { key: 'first_name', label: 'First name', type: 'text' },
  { key: 'last_name', label: 'Last name', type: 'text' },
  { key: 'middle_initial', label: 'Middle initial', type: 'text' },
  { key: 'suffix', label: 'Suffix', type: 'text' },
  { key: 'contact_number', label: 'Contact number', type: 'text' },
  { key: 'batch_year', label: 'Batch year', type: 'number' },
];

function fieldControl(f){
  const current = currentProfile[f.key] ?? '';
  return `<input type="${f.type}" id="edit_${f.key}" value="${current}">`;
}

// Auto-capitalize helpers — names get "First letter big, rest small" per
// word, regardless of how the person typed it (all caps, all lowercase, etc).
function titleCase(str){
  if (!str) return str;
  return str.trim().split(/\s+/).map(w =>
    w.length ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w
  ).join(' ');
}

// Suffix has its own rules: Jr./Sr. get a capital + period, roman numerals
// (II, III, IV...) stay fully uppercase instead of becoming "Iii".
function formatSuffix(str){
  if (!str) return str;
  const clean = str.trim().replace(/\.$/, '');
  const upper = clean.toUpperCase();
  if (upper === 'JR') return 'Jr.';
  if (upper === 'SR') return 'Sr.';
  if (/^(I|II|III|IV|V|VI)$/.test(upper)) return upper;
  return titleCase(str);
}

// Re-capitalizes a name field the moment the person clicks/tabs away from it.
function attachAutoCapitalize(){
  ['edit_first_name', 'edit_last_name', 'edit_middle_initial'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('blur', () => { el.value = titleCase(el.value); });
  });
}

// Suffix is a fixed dropdown now — no more typo risk from free typing.
// If a profile already has a custom value that isn't in the standard list
// (from before this change), it's kept as an extra option so it's not lost.
const SUFFIX_OPTIONS = ['Jr.', 'Sr.', 'II', 'III', 'IV', 'V'];
function suffixOptionsHtml(current){
  const list = (current && !SUFFIX_OPTIONS.includes(current))
    ? [...SUFFIX_OPTIONS, current]
    : SUFFIX_OPTIONS;
  const opts = list.map(v => `<option value="${v}" ${v === current ? 'selected' : ''}>${v}</option>`).join('');
  return `<option value="" ${!current ? 'selected' : ''}>None</option>${opts}`;
}

/* -------------------- LOAD DASHBOARD DATA -------------------- */
async function loadDashboard(user){
  const [{ data: profile, error }] = await Promise.all([
    sb.from('student_profiles').select('*').eq('user_id', user.id).single(),
    loadLookups(),
  ]);

  if (error) {
    console.error(error);
  }

  currentUser = user;
  currentProfile = profile || {};
  profileEditMode = false;

  const firstName = titleCase(currentProfile.first_name || '');
  document.getElementById('dashGreeting').textContent = firstName ? `Welcome back, ${firstName}` : 'Welcome back';

  renderProfileGrid();
  showDashboard();
}

/* -------------------- CASCADING EDUCATION FIELDS -------------------- */
function refreshCourseSelect(levelId, selectedCourseId){
  const wrap = document.getElementById('courseFieldWrap');
  const select = document.getElementById('edit_course_id');
  const list = levelId ? coursesForLevel(levelId) : [];

  if (!list.length) {
    wrap.classList.add('hidden');
    select.innerHTML = '<option value="">—</option>';
    refreshMajorSelect(null, null);
    return;
  }

  wrap.classList.remove('hidden');
  const lvl = levelById(levelId);
  wrap.querySelector('label').textContent = courseWrapLabel(lvl && lvl.code);
  select.innerHTML = optionsHtml(list, selectedCourseId);
  refreshMajorSelect(selectedCourseId, currentProfile.major_id);
}

function refreshMajorSelect(courseId, selectedMajorId){
  const wrap = document.getElementById('majorFieldWrap');
  const select = document.getElementById('edit_major_id');
  const course = courseId ? courseById(courseId) : null;

  if (!course || !course.has_major) {
    wrap.classList.add('hidden');
    select.innerHTML = '<option value="">—</option>';
    return;
  }

  wrap.classList.remove('hidden');
  select.innerHTML = optionsHtml(majorsForCourse(courseId), selectedMajorId);
}

function bindCascadingListeners(){
  document.getElementById('edit_education_level_id').addEventListener('change', (e) => {
    refreshCourseSelect(e.target.value || null, null);
  });
  document.getElementById('edit_course_id').addEventListener('change', (e) => {
    refreshMajorSelect(e.target.value || null, null);
  });
}

/* -------------------- RENDER PROFILE GRID -------------------- */
function renderProfileGrid(){
  const grid = document.getElementById('profileGrid');
  const actions = document.getElementById('profileEditActions');
  const editBtn = document.getElementById('editProfileBtn');

  if (!profileEditMode) {
    const level = levelById(currentProfile.education_level_id);
    const school = schoolById(currentProfile.school_id);
    const course = courseById(currentProfile.course_id);
    const major = majorById(currentProfile.major_id);

    const rows = [
      ['Email', currentUser.email],
      ['First name', titleCase(currentProfile.first_name) || 'Not set yet'],
      ['Last name', titleCase(currentProfile.last_name) || 'Not set yet'],
      ['Middle initial', titleCase(currentProfile.middle_initial) || 'Not set yet'],
      ['Suffix', currentProfile.suffix || 'Not set yet'],
      ['Education level', level ? level.label : 'Not set yet'],
      ['School', school ? school.name : 'Not set yet'],
      [courseWrapLabel(level && level.code), course ? course.name : 'Not set yet'],
      ['Major', major ? major.name : 'Not set yet'],
      ['Batch year', currentProfile.batch_year || 'Not set yet'],
      ['Contact number', currentProfile.contact_number || 'Not set yet'],
    ];
    grid.innerHTML = rows.map(([label, val]) => `
      <div class="profile-field">
        <span class="eyebrow">${label}</span>
        <div class="val">${val}</div>
      </div>
    `).join('');
    actions.classList.add('hidden');
    editBtn.textContent = 'Edit details';
    editBtn.classList.remove('hidden');
    return;
  }

  // Edit mode: email stays read-only, simple fields become inputs, and the
  // education block becomes 4 cascading selects — Level → School / Course →
  // Major (Major only appears when the selected course actually has one).
  grid.innerHTML = `
    <div class="profile-field">
      <span class="eyebrow">Email</span>
      <div class="val val-locked">${currentUser.email}</div>
    </div>
    <div class="profile-field">
      <label class="eyebrow" for="edit_first_name">First name</label>
      ${fieldControl(EDITABLE_FIELDS[0])}
    </div>
    <div class="profile-field">
      <label class="eyebrow" for="edit_last_name">Last name</label>
      ${fieldControl(EDITABLE_FIELDS[1])}
    </div>
    <div class="profile-field">
      <label class="eyebrow" for="edit_middle_initial">Middle initial</label>
      ${fieldControl(EDITABLE_FIELDS[2])}
    </div>
    <div class="profile-field">
      <label class="eyebrow" for="edit_suffix">Suffix</label>
      <select id="edit_suffix">${suffixOptionsHtml(currentProfile.suffix)}</select>
    </div>
    <div class="profile-field">
      <label class="eyebrow" for="edit_education_level_id">Education level</label>
      <select id="edit_education_level_id">${optionsHtml(LOOKUPS.levels, currentProfile.education_level_id, 'label')}</select>
    </div>
    <div class="profile-field">
      <label class="eyebrow" for="edit_school_id">School</label>
      <select id="edit_school_id">${optionsHtml(LOOKUPS.schools, currentProfile.school_id)}</select>
    </div>
    <div class="profile-field hidden" id="courseFieldWrap">
      <label class="eyebrow" for="edit_course_id">Course</label>
      <select id="edit_course_id"></select>
    </div>
    <div class="profile-field hidden" id="majorFieldWrap">
      <label class="eyebrow" for="edit_major_id">Major</label>
      <select id="edit_major_id"></select>
    </div>
    <div class="profile-field">
      <label class="eyebrow" for="edit_batch_year">Batch year</label>
      ${fieldControl(EDITABLE_FIELDS[6])}
    </div>
    <div class="profile-field">
      <label class="eyebrow" for="edit_contact_number">Contact number</label>
      ${fieldControl(EDITABLE_FIELDS[5])}
    </div>
  `;
  actions.classList.remove('hidden');
  editBtn.classList.add('hidden');

  bindCascadingListeners();
  attachAutoCapitalize();
  // Populate course/major based on whatever level+course is already saved.
  refreshCourseSelect(currentProfile.education_level_id, currentProfile.course_id);
}

document.getElementById('editProfileBtn').addEventListener('click', () => {
  clearAlert('profileAlert');
  profileEditMode = true;
  renderProfileGrid();
});

document.getElementById('cancelProfileBtn').addEventListener('click', () => {
  clearAlert('profileAlert');
  profileEditMode = false;
  renderProfileGrid();
});

document.getElementById('saveProfileBtn').addEventListener('click', async () => {
  clearAlert('profileAlert');

  const textVal = (id) => {
    const raw = document.getElementById(id).value.trim();
    return raw === '' ? null : raw;
  };

  const updates = {
    first_name: titleCase(textVal('edit_first_name')),
    last_name: titleCase(textVal('edit_last_name')),
    middle_initial: titleCase(textVal('edit_middle_initial')),
    suffix: textVal('edit_suffix'),
    student_number: textVal('edit_student_number'),
    contact_number: textVal('edit_contact_number'),
    batch_year: (() => {
      const raw = document.getElementById('edit_batch_year').value.trim();
      return raw === '' ? null : Number(raw);
    })(),
    education_level_id: textVal('edit_education_level_id'),
    school_id: textVal('edit_school_id'),
    course_id: textVal('edit_course_id'),
    major_id: textVal('edit_major_id'),
  };

  const btn = document.getElementById('saveProfileBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Saving…';

  const { data, error } = await sb
    .from('student_profiles')
    .update(updates)
    .eq('user_id', currentUser.id)
    .select()
    .single();

  btn.disabled = false;
  btn.textContent = 'Save changes';

  if (error) {
    alertBox('profileAlert', error.message, 'error');
    return;
  }

  currentProfile = data;
  profileEditMode = false;
  renderProfileGrid();
  alertBox('profileAlert', 'Details updated.', 'success');
});

/* -------------------- BOOTSTRAP: check session on load -------------------- */
(async function init(){
  const { data: { session } } = await sb.auth.getSession();

  if (session?.user) {
    const user = session.user;
    if (!user.email_confirmed_at && !user.confirmed_at) {
      document.getElementById('verifyEmailShown').textContent = user.email;
      showView('verify');
    } else {
      await loadDashboard(user);
    }
  } else {
    showView('login');
  }
})();

// Keep the UI in sync if auth state changes in another tab.
sb.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT') {
    showView('login');
  }
});