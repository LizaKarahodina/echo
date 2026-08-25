(function(){
'use strict';

/* ===== App state. Circles/answers are persisted in Supabase (see loadCirclesFromServer);
   no localStorage/sessionStorage is used client-side. ===== */
var Echo = {
  screen: 'splash',
  circles: [],
  current: null,
  currentQuestion: null,
  selectedCategory: 'new',
  lang: 'uk',
  muted: true,
  session: null
};

/* ===== Supabase ===== */
var SUPABASE_URL = 'https://nyierjjrgbrnvccymjhl.supabase.co';
var SUPABASE_ANON_KEY = 'sb_publishable_tKzzyd5Gn2iQMh_7c3V1Yw_i8EQh8iK';
var supabase = null;
var supabaseReadyPromise = null;

function loadSupabase(){
  if (!supabaseReadyPromise){
    supabaseReadyPromise = import('https://esm.sh/@supabase/supabase-js@2').then(function(mod){
      supabase = mod.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      supabase.auth.onAuthStateChange(function(event, session){
        onAuthStateChanged(session);
      });
      return supabase;
    }).catch(function(err){
      console.error('Failed to load Supabase client', err);
    });
  }
  return supabaseReadyPromise;
}

/* ===== Auth ===== */
var splashTimerDone = false;
var authResolved = false;

function isValidEmail(v){
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function cleanRedirectUrl(){
  return window.location.origin + window.location.pathname;
}

function sendMagicLink(){
  var email = els.authEmail.value.trim();
  els.authEmailError.classList.remove('show');
  els.authEmail.style.borderColor = '';
  if (!isValidEmail(email)){
    els.authEmailError.classList.add('show');
    els.authEmail.style.borderColor = 'var(--border-active)';
    els.authEmail.focus();
    return;
  }
  loadSupabase().then(function(client){
    return client.auth.signInWithOtp({ email: email, options: { emailRedirectTo: cleanRedirectUrl() } });
  }).then(function(res){
    if (res.error){
      showToast(STRINGS.authError[Echo.lang]);
      console.error('signInWithOtp failed', res.error);
      return;
    }
    showToast(STRINGS.authLinkSent[Echo.lang], { duration: 4200 });
  });
}

function signInWithGoogle(){
  loadSupabase().then(function(client){
    return client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: cleanRedirectUrl() } });
  });
}

function continueAsGuest(){
  loadSupabase().then(function(client){
    return client.auth.signInAnonymously();
  }).then(function(res){
    if (res.error){
      showToast(STRINGS.authError[Echo.lang]);
      console.error('signInAnonymously failed', res.error);
    }
  });
}

function signOut(){
  if (!supabase) return;
  supabase.auth.signOut();
}

function hydrateCircle(row, answers){
  var askedIds = [];
  var notes = {};
  var seen = {};
  answers.forEach(function(a){
    var qid = a.question_id;
    if (!seen[qid]){ seen[qid] = true; askedIds.push(qid); }
    if (a.note != null) notes[String(qid)] = a.note;
    else delete notes[String(qid)];
  });
  var c = {
    id: row.id,
    name: row.name,
    category: row.category,
    askedIds: askedIds,
    notes: notes,
    growthLevel: 1,
    flipped: false
  };
  c.growthLevel = growthStage(c);
  return c;
}

function loadCirclesFromServer(){
  if (!supabase || !Echo.session) return Promise.resolve();
  var userId = Echo.session.user.id;
  return Promise.all([
    supabase.from('circles').select('*').eq('user_id', userId).order('created_at'),
    supabase.from('answers').select('*').eq('user_id', userId).order('created_at')
  ]).then(function(results){
    var circlesRes = results[0];
    var answersRes = results[1];
    if (circlesRes.error){
      console.error('load circles failed', circlesRes.error);
      Echo.circles = [];
      return;
    }
    var answersByCircle = {};
    if (answersRes.error){
      console.error('load answers failed', answersRes.error);
    } else {
      (answersRes.data || []).forEach(function(a){
        if (!answersByCircle[a.circle_id]) answersByCircle[a.circle_id] = [];
        answersByCircle[a.circle_id].push(a);
      });
    }
    Echo.circles = (circlesRes.data || []).map(function(row){
      return hydrateCircle(row, answersByCircle[row.id] || []);
    });
  });
}

function insertAnswer(c, questionId, note){
  if (!supabase || !Echo.session) return;
  supabase.from('answers').insert({
    user_id: Echo.session.user.id,
    circle_id: c.id,
    question_id: questionId,
    note: note || null
  }).then(function(res){
    if (res.error) console.error('insertAnswer failed', res.error);
  });
}

function maybeLeaveSplash(){
  if (!splashTimerDone || !authResolved) return;
  if (Echo.session){
    loadCirclesFromServer().then(function(){
      renderCirclesList();
      showScreen('circles');
    });
  } else {
    showScreen('auth');
  }
}

function onAuthStateChanged(session){
  var hadSession = !!Echo.session;
  Echo.session = session;
  authResolved = true;
  if (window.location.hash){
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  if (!splashTimerDone){
    maybeLeaveSplash();
    return;
  }
  if (session && !hadSession){
    loadCirclesFromServer().then(function(){
      renderCirclesList();
      showScreen('circles');
    });
  } else if (!session && hadSession){
    Echo.circles = [];
    Echo.current = null;
    showScreen('auth');
  }
}

var FLIP_MS = 520;

var TAGS = {
  new: { cls: 'new', uk: 'Нові знайомства', en: 'New connections' },
  relationship: { cls: 'relationship', uk: 'Стосунки', en: 'Relationship' },
  friendship: { cls: 'friendship', uk: 'Дружба', en: 'Friendship' }
};

var LANG_LABEL = { uk: 'UA', en: 'EN' };

/* ===== UI copy — switched app-wide by the language toggle ===== */
var STRINGS = {
  appTitle: { uk: 'Мої діалоги', en: 'My dialogs' },
  emptyGreeting: { uk: 'Привіт!', en: 'Hi!' },
  emptyGreetingName: { uk: 'Привіт, {name}!', en: 'Hi, {name}!' },
  emptyDesc: { uk: 'Я буду рости, поки ти дізнаватимешся більше про людей і про себе ✨', en: 'I will grow as you learn more about people and about yourself ✨' },
  createDialog: { uk: 'Створити діалог', en: 'Start a dialog' },
  newDialogTitle: { uk: 'Новий діалог', en: 'New dialog' },
  newDialogSubtitle: { uk: 'Створимо простір для цікавих розмов і нових відкриттів ✨', en: 'Let’s create space for interesting conversations and new discoveries ✨' },
  nameLabel: { uk: 'Ім’я', en: 'Name' },
  namePlaceholder: { uk: 'Наприклад, Артем', en: 'e.g. Artem' },
  nameError: { uk: 'Введи ім’я, щоб продовжити', en: 'Enter a name to continue' },
  categoryLabel: { uk: 'Що вас пов’язує?', en: 'What connects you?' },
  catNewTitle: { uk: 'Нове знайомство', en: 'New acquaintance' },
  catNewDesc: { uk: 'Легкі й безпечні питання, щоб краще пізнати одне одного', en: 'Light, safe questions to get to know each other better' },
  catRelTitle: { uk: 'Стосунки', en: 'Relationship' },
  catRelDesc: { uk: 'Глибокі питання, щоб зміцнити зв’язок і дізнатися більше одне про одного', en: 'Deep questions to strengthen your bond and learn more about each other' },
  catFriendTitle: { uk: 'Дружба', en: 'Friendship' },
  catFriendDesc: { uk: 'Щоб краще зрозуміти, підтримати і стати ближчими', en: 'To understand, support, and grow closer' },
  questionsAsked: { uk: 'Питань пройдено', en: 'Questions asked' },
  tapToFlip: { uk: 'Клікни на картку, щоб перегорнути', en: 'Tap the card to flip it' },
  tagline: { uk: 'Що витягнеш сьогодні?', en: 'What will you draw today?' },
  skip: { uk: 'Пропустити', en: 'Skip' },
  answered: { uk: 'Запитано', en: 'Asked' },
  noteTitle: { uk: 'Залиш нотатку', en: 'Leave a note' },
  noteSub: { uk: 'Що запам’яталось із цієї відповіді? Необов’язково ✨', en: 'What stood out from this answer? Optional ✨' },
  notePlaceholder: { uk: 'Наприклад: сказав(ла), що мріє про подорож у Карпати…', en: 'e.g.: said they dream of a trip to the mountains…' },
  noteSave: { uk: 'Зберігти', en: 'Save' },
  toastGrowth: { uk: 'Ого, ви вже трохи ближчі ✨', en: 'Wow, you are already a bit closer ✨' },
  toastDeleted: { uk: 'Діалог видалено', en: 'Dialog deleted' },
  deleteTitle: { uk: 'Видалити діалог?', en: 'Delete this dialog?' },
  deleteCancel: { uk: 'Скасувати', en: 'Cancel' },
  deleteConfirm: { uk: 'Видалити', en: 'Delete' },
  dialogMenuTitle: { uk: 'Діалог', en: 'Dialog' },
  menuNotes: { uk: 'Мої нотатки', en: 'My notes' },
  menuLang: { uk: 'Змінити мову на English', en: 'Change language to Українська' },
  menuDelete: { uk: 'Видалити діалог', en: 'Delete dialog' },
  notesScreenSubtitle: { uk: 'Історія цього кола', en: 'This circle’s history' },
  notesEmptyTitle: { uk: 'Тут зберігатимуться важливі моменти ✨', en: 'Important moments will be kept here ✨' },
  notesEmptySubtitle: { uk: 'Після відповідей ти зможеш залишати нотатки про те, що хочеш запам’ятати.', en: 'After answering, you’ll be able to leave notes about what you want to remember.' },
  authTitle: { uk: 'Твоя історія починається тут ✨', en: 'Your story begins here ✨' },
  authSubtitle: { uk: 'Увійди, щоб зберігати свої кола, відповіді та моменти, до яких захочеться повернутися.', en: 'Sign in to keep your circles, answers, and moments you’ll want to come back to.' },
  authEmailLabel: { uk: 'Пошта', en: 'Email' },
  authEmailError: { uk: 'Введи коректну пошту', en: 'Enter a valid email' },
  authSendLink: { uk: 'Надіслати посилання', en: 'Send magic link' },
  authLinkSent: { uk: 'Перевір пошту — ми надіслали посилання для входу ✨ Й зазирни у Спам — листи іноді туди тікають 🙈', en: 'Check your email — we sent a sign-in link ✨ And peek into Spam too — emails sometimes wander off 🙈' },
  authError: { uk: 'Щось пішло не так. Спробуй ще раз.', en: 'Something went wrong. Please try again.' },
  authGoogle: { uk: 'Продовжити з Google', en: 'Continue with Google' },
  authGuest: { uk: 'Продовжити без входу', en: 'Continue without an account' },
  storyCompleteTitle: { uk: 'Ваша історія завершилась ✨', en: 'Your story has ended ✨' },
  storyCompleteSubtitle: { uk: 'Іскра, з якої все почалося, стала частиною вашої спільної історії.', en: 'The spark that started it all has become part of your shared history.' },
  viewNotes: { uk: 'Переглянути нотатки', en: 'View notes' }
};

/* ===== Іскрик growth assets — stable Cloudinary URLs, do not regenerate ===== */
var NEW_DIALOG_IMAGE = 'https://res.cloudinary.com/dhdh7bf7g/image/upload/v1787319811/new_dialog_scmscm.png';
var AUTH_MASCOT_IMAGE = 'https://res.cloudinary.com/dhdh7bf7g/image/upload/v1787586452/5b876c37-d9ec-4146-b601-3a058842eeeb_n1svzd.png';

var GROWTH = {
  images: [
    'https://res.cloudinary.com/dhdh7bf7g/image/upload/v1787235483/Echo_1_qghgkr.jpg',
    'https://res.cloudinary.com/dhdh7bf7g/image/upload/v1787235483/Echo_2_dfxd55.png',
    'https://res.cloudinary.com/dhdh7bf7g/image/upload/v1787235483/Echo_3_hyvvxs.png',
    'https://res.cloudinary.com/dhdh7bf7g/image/upload/v1787235483/Echo_4_etsjnz.png',
    'https://res.cloudinary.com/dhdh7bf7g/image/upload/v1787237849/Echo_5_gpfm5i.png'
  ],
  idle: [
    'https://res.cloudinary.com/dhdh7bf7g/video/upload/v1787235620/Echo_1_IDLE_tuavjt.mp4',
    'https://res.cloudinary.com/dhdh7bf7g/video/upload/v1787237796/Echo_2_IDLE_hfwev9.mp4',
    'https://res.cloudinary.com/dhdh7bf7g/video/upload/v1787237797/Echo_3_tvoxw6.mp4',
    'https://res.cloudinary.com/dhdh7bf7g/video/upload/v1787237798/Echo_4_asmhsw.mp4',
    'https://res.cloudinary.com/dhdh7bf7g/video/upload/v1787237849/Echo_5_cttlo4.mp4'
  ],
  transitions: [
    'https://res.cloudinary.com/dhdh7bf7g/video/upload/v1787237796/Echo_1-2_xzsoen.mp4',
    'https://res.cloudinary.com/dhdh7bf7g/video/upload/v1787237797/Echo_2-3_inwpih.mp4',
    'https://res.cloudinary.com/dhdh7bf7g/video/upload/v1787237797/Echo_3-4_rt0pb7.mp4',
    'https://res.cloudinary.com/dhdh7bf7g/video/upload/v1787237849/Echo_4-5_hu6jjs.mp4'
  ]
};

/* ===== Icon set — thin outline, single color, swapped in for [data-icon] placeholders on init ===== */
var ICON = {
  arrowLeft: '<svg viewBox="0 0 24 24" fill="none"><path d="M10.295 19.716C10.3886 19.8082 10.4994 19.881 10.6211 19.9304C10.7429 19.9798 10.8731 20.0047 11.0045 20.0037C11.1358 20.0027 11.2657 19.9759 11.3867 19.9247C11.5076 19.8736 11.6173 19.7991 11.7095 19.7055C11.8017 19.6119 11.8746 19.5011 11.9239 19.3794C11.9733 19.2577 11.9982 19.1274 11.9972 18.9961C11.9963 18.8647 11.9694 18.7349 11.9183 18.6139C11.8671 18.4929 11.7926 18.3832 11.699 18.291L6.32903 13.001H19.999C20.2642 13.001 20.5186 12.8956 20.7061 12.7081C20.8937 12.5206 20.999 12.2662 20.999 12.001C20.999 11.7358 20.8937 11.4814 20.7061 11.2939C20.5186 11.1064 20.2642 11.001 19.999 11.001H6.33603L11.7 5.714C11.884 5.52678 11.987 5.27475 11.9867 5.01228C11.9865 4.74981 11.8831 4.49796 11.6988 4.31106C11.5145 4.12416 11.2642 4.0172 11.0017 4.01326C10.7393 4.00932 10.4858 4.10871 10.296 4.29L3.37203 11.112C3.25411 11.2283 3.16048 11.3669 3.09657 11.5196C3.03267 11.6724 2.99976 11.8364 2.99976 12.002C2.99976 12.1676 3.03267 12.3316 3.09657 12.4844C3.16048 12.6371 3.25411 12.7757 3.37203 12.892L10.296 19.715L10.295 19.716Z" fill="currentColor"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none"><path d="M11.883 3.007L12 3C12.2449 3.00003 12.4813 3.08996 12.6644 3.25272C12.8474 3.41547 12.9643 3.63975 12.993 3.883L13 4V11H20C20.2449 11 20.4813 11.09 20.6644 11.2527C20.8474 11.4155 20.9643 11.6397 20.993 11.883L21 12C21 12.2449 20.91 12.4813 20.7473 12.6644C20.5845 12.8474 20.3603 12.9643 20.117 12.993L20 13H13V20C13 20.2449 12.91 20.4813 12.7473 20.6644C12.5845 20.8474 12.3603 20.9643 12.117 20.993L12 21C11.7551 21 11.5187 20.91 11.3356 20.7473C11.1526 20.5845 11.0357 20.3603 11.007 20.117L11 20V13H4C3.75507 13 3.51866 12.91 3.33563 12.7473C3.15259 12.5845 3.03566 12.3603 3.007 12.117L3 12C3.00003 11.7551 3.08996 11.5187 3.25272 11.3356C3.41547 11.1526 3.63975 11.0357 3.883 11.007L4 11H11V4C11 3.75507 11.09 3.51866 11.2527 3.33563C11.4155 3.15259 11.6397 3.03566 11.883 3.007Z" fill="currentColor"/></svg>',
  sparkle: '<svg viewBox="0 0 18 18" fill="none"><path d="M9.9082 2.32725C9.53695 1.57425 8.4637 1.57425 8.09245 2.32725L6.32395 5.91L2.3692 6.4845C1.53895 6.60525 1.2067 7.626 1.8082 8.21175L4.66945 11.0017L3.99445 14.9393C3.85195 15.7665 4.72045 16.3973 5.46295 16.0072L8.99995 14.1473L12.5369 16.0072C13.2794 16.3973 14.1479 15.7673 14.0062 14.9393L13.3312 11.0017L16.1924 8.21175C16.7924 7.62675 16.4617 6.60525 15.6307 6.4845L11.6774 5.91L9.90745 2.32725H9.9082ZM0.872946 2.8365C0.779865 2.95307 0.736898 3.10183 0.753494 3.25008C0.770091 3.39832 0.844892 3.5339 0.961446 3.627L2.83645 5.127C2.95301 5.22019 3.10182 5.26326 3.25013 5.24673C3.32357 5.23855 3.39468 5.21598 3.4594 5.18032C3.52412 5.14465 3.58118 5.09659 3.62732 5.03888C3.67346 4.98116 3.70779 4.91492 3.72833 4.84394C3.74887 4.77296 3.75524 4.69863 3.74705 4.62519C3.73887 4.55175 3.7163 4.48064 3.68064 4.41592C3.64497 4.3512 3.59691 4.29414 3.5392 4.248L1.6642 2.748C1.60646 2.7018 1.54017 2.66743 1.46914 2.64687C1.3981 2.62631 1.32371 2.61996 1.25022 2.62818C1.17673 2.6364 1.10558 2.65903 1.04084 2.69477C0.976103 2.73052 0.91905 2.77868 0.872946 2.8365Z" fill="currentColor"/><path d="M17.1271 13.6635C17.2202 13.547 17.2633 13.3983 17.2469 13.2501C17.2304 13.1018 17.1558 12.9662 17.0393 12.873L15.1643 11.373C15.0478 11.2797 14.8989 11.2365 14.7505 11.253C14.6021 11.2695 14.4664 11.3442 14.3731 11.4607C14.2798 11.5773 14.2366 11.7262 14.2531 11.8745C14.2695 12.0229 14.3443 12.1587 14.4608 12.252L16.3358 13.752C16.3935 13.7982 16.4598 13.8327 16.5308 13.8533C16.6018 13.8739 16.6761 13.8803 16.7496 13.8722C16.8231 13.864 16.8943 13.8415 16.9591 13.8058C17.0238 13.7701 17.0809 13.7213 17.1271 13.6635ZM0.961565 12.873C0.845003 12.9662 0.770234 13.1019 0.753707 13.2502C0.73718 13.3985 0.78025 13.5473 0.87344 13.6639C0.966631 13.7804 1.10231 13.8552 1.25063 13.8717C1.39894 13.8883 1.54775 13.8452 1.66432 13.752L3.53932 12.252C3.65588 12.1588 3.73065 12.0231 3.74717 11.8748C3.7637 11.7265 3.72063 11.5777 3.62744 11.4611C3.53425 11.3446 3.39857 11.2698 3.25025 11.2533C3.10194 11.2367 2.95313 11.2798 2.83657 11.373L0.961565 12.873ZM17.1271 2.8365C17.2202 2.95297 17.2633 3.10168 17.2469 3.24992C17.2304 3.39816 17.1558 3.53379 17.0393 3.627L15.1643 5.127C15.0478 5.22029 14.8989 5.26345 14.7505 5.247C14.6021 5.23054 14.4664 5.15581 14.3731 5.03925C14.2798 4.92269 14.2366 4.77384 14.2531 4.62545C14.2695 4.47706 14.3443 4.34129 14.4608 4.248L16.3358 2.748C16.3936 2.7018 16.4598 2.66743 16.5309 2.64687C16.6019 2.62631 16.6763 2.61996 16.7498 2.62818C16.8233 2.6364 16.8944 2.65903 16.9592 2.69477C17.0239 2.73052 17.081 2.77868 17.1271 2.8365Z" fill="currentColor"/></svg>',
  heart: '<svg viewBox="0 0 18 18" fill="none"><path d="M9.61492 4.185L8.99992 4.8015L8.38192 4.1835C7.62586 3.42753 6.60045 3.00288 5.53128 3.00295C4.46211 3.00302 3.43676 3.42781 2.6808 4.18387C1.92483 4.93994 1.50017 5.96535 1.50024 7.03452C1.50031 8.10368 1.92511 9.12903 2.68117 9.885L8.60242 15.8063C8.70789 15.9116 8.85086 15.9708 8.99992 15.9708C9.14899 15.9708 9.29195 15.9116 9.39742 15.8063L15.3239 9.8835C16.0791 9.12737 16.5032 8.10237 16.5031 7.03372C16.5029 5.96507 16.0785 4.94018 15.3232 4.18425C14.9485 3.80928 14.5035 3.51182 14.0138 3.30888C13.5241 3.10593 12.9992 3.00148 12.469 3.00148C11.9389 3.00148 11.414 3.10593 10.9243 3.30888C10.4346 3.51182 9.98964 3.81003 9.61492 4.185Z" fill="currentColor"/></svg>',
  chat: '<svg viewBox="0 0 18 18" fill="none"><path d="M7.12494 2.25C6.17862 2.24972 5.24752 2.4882 4.41784 2.94335C3.58816 3.3985 2.88673 4.05562 2.37847 4.85387C1.8702 5.65211 1.57155 6.56569 1.51015 7.51002C1.44874 8.45435 1.62658 9.39891 2.02719 10.2563C1.83842 11.0376 1.66812 11.8233 1.51644 12.6127C1.49336 12.7318 1.49962 12.8548 1.53469 12.9709C1.56976 13.087 1.63259 13.1928 1.71773 13.2792C1.80287 13.3656 1.90778 13.43 2.02337 13.4668C2.13897 13.5035 2.26178 13.5116 2.38119 13.4902C2.84844 13.4077 3.86469 13.2202 4.80819 13.0028C5.57292 13.3476 6.4051 13.517 7.24379 13.4986C8.08247 13.4803 8.90643 13.2745 9.65531 12.8965C10.4042 12.5185 11.059 11.9777 11.5719 11.3139C12.0848 10.65 12.4426 9.87982 12.6193 9.05975C12.796 8.23968 12.787 7.39048 12.5931 6.57433C12.3991 5.75817 12.025 4.99574 11.4982 4.34286C10.9715 3.68998 10.3054 3.1632 9.54865 2.80107C8.79194 2.43895 7.96383 2.25066 7.12494 2.25ZM7.09644 14.25C8.1356 15.2161 9.50253 15.7522 10.9214 15.75C11.7464 15.75 12.5302 15.5723 13.2374 15.2528C14.0197 15.4357 14.8769 15.6187 15.4222 15.7327C15.5757 15.765 15.7348 15.758 15.8849 15.7124C16.035 15.6668 16.1712 15.5841 16.2808 15.472C16.3905 15.3599 16.4701 15.2219 16.5124 15.0708C16.5546 14.9198 16.5581 14.7605 16.5224 14.6077C16.4009 14.0805 16.2089 13.2615 16.0192 12.5055C16.3525 11.7915 16.5322 11.0154 16.5465 10.2275C16.5609 9.43963 16.4096 8.65752 16.1024 7.93183C15.7953 7.20614 15.3392 6.55304 14.7636 6.01483C14.188 5.47662 13.5058 5.0653 12.7612 4.8075C13.0273 5.29115 13.229 5.80753 13.3612 6.3435C13.9936 6.75111 14.5135 7.31089 14.8735 7.97156C15.2334 8.63222 15.4218 9.37265 15.4214 10.125C15.4214 10.869 15.2414 11.5687 14.9227 12.1852L14.8252 12.375L14.8777 12.582C15.0487 13.2532 15.2279 14.007 15.3592 14.5695C14.7787 14.4473 13.9957 14.277 13.3042 14.112L13.1062 14.0655L12.9239 14.1562C12.3209 14.4562 11.6414 14.625 10.9214 14.625C10.155 14.6264 9.40092 14.4312 8.73144 14.058C8.197 14.1923 7.64744 14.2568 7.09644 14.25Z" fill="currentColor"/></svg>',
  soundOn: '<svg viewBox="0 0 24 24" fill="none"><path d="M15 4.25v15.496c0 1.078-1.274 1.65-2.08.934l-4.492-3.994a.75.75 0 0 0-.498-.19H4.25A2.25 2.25 0 0 1 2 14.247V9.75a2.25 2.25 0 0 1 2.25-2.25h3.68a.75.75 0 0 0 .498-.19l4.491-3.993C13.726 2.599 15 3.17 15 4.25Zm3.992 1.647a.75.75 0 0 1 1.049.157A9.959 9.959 0 0 1 22 12a9.96 9.96 0 0 1-1.96 5.946.75.75 0 0 1-1.205-.892A8.459 8.459 0 0 0 20.5 12a8.459 8.459 0 0 0-1.665-5.054.75.75 0 0 1 .157-1.049ZM17.143 8.37a.75.75 0 0 1 1.017.303c.536.99.84 2.125.84 3.328a6.973 6.973 0 0 1-.84 3.328.75.75 0 0 1-1.32-.714c.42-.777.66-1.666.66-2.614s-.24-1.837-.66-2.614a.75.75 0 0 1 .303-1.017Z" fill="currentColor"/></svg>',
  soundOff: '<svg viewBox="0 0 24 24" fill="none"><path d="M15 4.25c0-1.079-1.274-1.65-2.08-.934L8.427 7.309a.75.75 0 0 1-.498.19H4.25A2.25 2.25 0 0 0 2 9.749v4.497a2.25 2.25 0 0 0 2.25 2.25h3.68a.75.75 0 0 1 .498.19l4.491 3.994c.806.716 2.081.144 2.081-.934V4.25Z" fill="currentColor"/><path d="M16.22 9.22a.75.75 0 0 1 1.06 0L19 10.94l1.72-1.72a.75.75 0 1 1 1.06 1.06L20.06 12l1.72 1.72a.75.75 0 1 1-1.06 1.06L19 13.06l-1.72 1.72a.75.75 0 1 1-1.06-1.06L17.94 12l-1.72-1.72a.75.75 0 0 1 0-1.06Z" fill="currentColor"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none"><path d="M13.94 5 19 10.06 9.062 20a2.25 2.25 0 0 1-.999.58l-5.116 1.395a.75.75 0 0 1-.92-.921l1.395-5.116a2.25 2.25 0 0 1 .58-.999L13.938 5Zm7.09-2.03a3.578 3.578 0 0 1 0 5.06l-.97.97L15 3.94l.97-.97a3.578 3.578 0 0 1 5.06 0Z" fill="currentColor"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none"><path d="M5.55815 5.72372L5.63593 5.63604C5.80915 5.46287 6.0399 5.35929 6.28441 5.34495C6.52893 5.33062 6.7702 5.40652 6.96247 5.55826L7.05015 5.63604L11.9999 10.5858L16.9496 5.63604C17.1229 5.46287 17.3536 5.35929 17.5981 5.34495C17.8426 5.33062 18.0839 5.40652 18.2762 5.55826L18.3639 5.63604C18.537 5.80926 18.6406 6.04001 18.6549 6.28452C18.6693 6.52903 18.5934 6.7703 18.4416 6.96257L18.3639 7.05025L13.4141 12L18.3639 16.9497C18.537 17.123 18.6406 17.3537 18.6549 17.5982C18.6693 17.8427 18.5934 18.084 18.4416 18.2763L18.3639 18.364C18.1906 18.5371 17.9599 18.6407 17.7154 18.655C17.4709 18.6694 17.2296 18.5935 17.0373 18.4417L16.9496 18.364L11.9999 13.4142L7.05015 18.364C6.87693 18.5371 6.64618 18.6407 6.40167 18.655C6.15716 18.6694 5.91588 18.5935 5.72361 18.4417L5.63593 18.364C5.46276 18.1907 5.35919 17.96 5.34485 17.7155C5.33051 17.471 5.40641 17.2297 5.55815 17.0374L5.63593 16.9497L10.5857 12L5.63593 7.05025C5.46276 6.87704 5.35919 6.64629 5.34485 6.40177C5.33051 6.15726 5.40641 5.91599 5.55815 5.72372Z" fill="currentColor"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none"><path d="M21.5 6a1 1 0 0 1-.883.993L20.5 7h-.845l-1.231 12.52A2.75 2.75 0 0 1 15.687 22H8.313a2.75 2.75 0 0 1-2.737-2.48L4.345 7H3.5a1 1 0 0 1 0-2h5a3.5 3.5 0 1 1 7 0h5a1 1 0 0 1 1 1Zm-7.25 3.25a.75.75 0 0 0-.743.648L13.5 10v7l.007.102a.75.75 0 0 0 1.486 0L15 17v-7l-.007-.102a.75.75 0 0 0-.743-.648Zm-4.5 0a.75.75 0 0 0-.743.648L9 10v7l.007.102a.75.75 0 0 0 1.486 0L10.5 17v-7l-.007-.102a.75.75 0 0 0-.743-.648ZM12 3.5A1.5 1.5 0 0 0 10.5 5h3A1.5 1.5 0 0 0 12 3.5Z" fill="currentColor"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 8C11.4696 8 10.9609 7.78929 10.5858 7.41421C10.2107 7.03914 10 6.53043 10 6C10 5.46957 10.2107 4.96086 10.5858 4.58579C10.9609 4.21071 11.4696 4 12 4C12.5304 4 13.0391 4.21071 13.4142 4.58579C13.7893 4.96086 14 5.46957 14 6C14 6.53043 13.7893 7.03914 13.4142 7.41421C13.0391 7.78929 12.5304 8 12 8ZM12 14C11.4696 14 10.9609 13.7893 10.5858 13.4142C10.2107 13.0391 10 12.5304 10 12C10 11.4696 10.2107 10.9609 10.5858 10.5858C10.9609 10.2107 11.4696 10 12 10C12.5304 10 13.0391 10.2107 13.4142 10.5858C13.7893 10.9609 14 11.4696 14 12C14 12.5304 13.7893 13.0391 13.4142 13.4142C13.0391 13.7893 12.5304 14 12 14ZM10 18C10 18.5304 10.2107 19.0391 10.5858 19.4142C10.9609 19.7893 11.4696 20 12 20C12.5304 20 13.0391 19.7893 13.4142 19.4142C13.7893 19.0391 14 18.5304 14 18C14 17.4696 13.7893 16.9609 13.4142 16.5858C13.0391 16.2107 12.5304 16 12 16C11.4696 16 10.9609 16.2107 10.5858 16.5858C10.2107 16.9609 10 17.4696 10 18Z" fill="currentColor"/></svg>',
  notes: '<svg viewBox="0 0 24 24" fill="none"><path d="M17.75 3A3.25 3.25 0 0 1 21 6.25V13h-4.75A3.25 3.25 0 0 0 13 16.25V21H6.25A3.25 3.25 0 0 1 3 17.75V6.25A3.25 3.25 0 0 1 6.25 3h11.5Zm2.81 11.5-6.06 6.06v-4.31c0-.966.784-1.75 1.75-1.75h4.31Z" fill="currentColor"/></svg>',
  language: '<svg viewBox="0 0 24 24" fill="none"><path d="M8.904 16.5h6.192C14.476 19.773 13.234 22 12 22c-1.197 0-2.4-2.094-3.038-5.204l-.058-.294h6.192-6.192Zm-5.838.001H7.37c.365 2.082.983 3.854 1.793 5.093a10.029 10.029 0 0 1-5.952-4.814l-.146-.279Zm13.563 0h4.305a10.028 10.028 0 0 1-6.097 5.093c.755-1.158 1.344-2.778 1.715-4.681l.076-.412h4.306-4.306Zm.302-6.5h4.87a10.055 10.055 0 0 1-.257 5H16.84a28.539 28.539 0 0 0 .13-4.344L16.93 10h4.87-4.87ZM2.198 10h4.87a28.211 28.211 0 0 0 .034 4.42l.057.58H2.456a10.047 10.047 0 0 1-.258-5Zm6.377 0h6.85a25.838 25.838 0 0 1-.037 4.425l-.062.575H8.674a25.979 25.979 0 0 1-.132-4.512L8.575 10h6.85-6.85Zm6.37-7.424-.109-.17A10.027 10.027 0 0 1 21.372 8.5H16.78c-.316-2.416-.956-4.492-1.837-5.923l-.108-.17.108.17Zm-5.903-.133.122-.037C8.283 3.757 7.628 5.736 7.28 8.06l-.061.44H2.628a10.028 10.028 0 0 1 6.414-6.057l.122-.037-.122.037ZM12 2.002c1.319 0 2.646 2.542 3.214 6.183l.047.315H8.739C9.28 4.691 10.643 2.002 12 2.002Z" fill="currentColor"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none"><path d="M9 21H5.75A1.75 1.75 0 0 1 4 19.25V4.75A1.75 1.75 0 0 1 5.75 3H9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 17l5-5-5-5M21 12H9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};

var els = {};
var growthTimer = null;
var circlesGrowthTimer = null;

function cacheEls(){
  els.screen_splash = document.getElementById('screen-splash');
  els.screen_auth = document.getElementById('screen-auth');
  els.screen_circles = document.getElementById('screen-circles');
  els.screen_newcircle = document.getElementById('screen-newcircle');
  els.screen_draw = document.getElementById('screen-draw');

  els.authMascot = document.getElementById('auth-mascot');
  els.authEmail = document.getElementById('auth-email');
  els.authEmailError = document.getElementById('auth-email-error');
  els.btnAuthMagicLink = document.getElementById('btn-auth-magic-link');
  els.btnAuthGoogle = document.getElementById('btn-auth-google');
  els.btnAuthGuest = document.getElementById('btn-auth-guest');
  els.btnSignOut = document.getElementById('btn-sign-out');

  els.circlesList = document.getElementById('circles-list');
  els.circlesMascot = document.getElementById('circles-mascot');
  els.circlesScreenContent = document.querySelector('#screen-circles > .screen-content');
  els.btnFabCreate = document.getElementById('btn-fab-create');
  els.deleteModal = document.getElementById('delete-modal');
  els.deleteSubText = document.getElementById('delete-sub-text');
  els.btnDeleteClose = document.getElementById('btn-delete-close');
  els.btnDeleteCancel = document.getElementById('btn-delete-cancel');
  els.btnDeleteConfirm = document.getElementById('btn-delete-confirm');
  els.btnBackToCircles = document.getElementById('btn-back-to-circles');
  els.btnBackToCircles2 = document.getElementById('btn-back-to-circles-2');

  els.newcircleMascot = document.getElementById('newcircle-mascot');
  els.inputName = document.getElementById('input-name');
  els.nameError = document.getElementById('name-error');
  els.optionList = document.getElementById('option-list');
  els.btnCreateCircle = document.getElementById('btn-create-circle');

  els.drawCircleName = document.getElementById('draw-circle-name');
  els.drawCircleTag = document.getElementById('draw-circle-tag');
  els.drawProgressLabel = document.getElementById('draw-progress-label');
  els.drawProgressFill = document.getElementById('draw-progress-fill');
  els.drawCard = document.getElementById('draw-card');
  els.drawVideo = document.getElementById('draw-video');
  els.drawTagline = document.getElementById('draw-tagline');
  els.drawCompleteSubtitle = document.getElementById('draw-complete-subtitle');
  els.drawQuestionText = document.getElementById('draw-question-text');
  els.drawHelperText = document.getElementById('draw-helper-text');
  els.drawActions = document.getElementById('draw-actions');
  els.btnSkip = document.getElementById('btn-skip');
  els.btnAnswered = document.getElementById('btn-answered');
  els.btnViewNotesComplete = document.getElementById('btn-view-notes-complete');
  els.btnEditNote = document.getElementById('btn-edit-note');
  els.btnDrawMenu = document.getElementById('btn-draw-menu');

  els.noteModal = document.getElementById('note-modal');
  els.noteText = document.getElementById('note-text');
  els.btnNoteClose = document.getElementById('btn-note-close');
  els.btnNoteSave = document.getElementById('btn-note-save');

  els.drawMenuModal = document.getElementById('draw-menu-modal');
  els.btnMenuClose = document.getElementById('btn-menu-close');
  els.btnMenuNotes = document.getElementById('btn-menu-notes');
  els.btnMenuLang = document.getElementById('btn-menu-lang');
  els.btnMenuDelete = document.getElementById('btn-menu-delete');

  els.screen_notes = document.getElementById('screen-notes');
  els.btnBackToDraw = document.getElementById('btn-back-to-draw');
  els.notesCircleName = document.getElementById('notes-circle-name');
  els.notesList = document.getElementById('notes-list');

  els.toast = document.getElementById('toast');
}

function buildIcons(){
  var nodes = document.querySelectorAll('[data-icon]');
  for (var i = 0; i < nodes.length; i++){
    var name = nodes[i].getAttribute('data-icon');
    if (ICON[name]) nodes[i].innerHTML = ICON[name];
  }
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, function(ch){
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch];
  });
}

/* ===== Question pool / growth math ===== */
function pool(c){
  if (c.category === 'new') return QUESTIONS.filter(function(q){ return q.s === 'g'; });
  if (c.category === 'friendship') return QUESTIONS.filter(function(q){ return q.s === 'f'; });
  return QUESTIONS.filter(function(q){ return q.s === 'g' || q.s === 'r'; });
}

function qText(q){
  return Echo.lang === 'en' ? q.en : q.uk;
}

/* ===== App-wide language switch ===== */
function applyI18n(){
  var nodes = document.querySelectorAll('[data-i18n]');
  for (var i = 0; i < nodes.length; i++){
    var key = nodes[i].getAttribute('data-i18n');
    if (STRINGS[key]) nodes[i].textContent = STRINGS[key][Echo.lang];
  }
  var placeholders = document.querySelectorAll('[data-i18n-placeholder]');
  for (var j = 0; j < placeholders.length; j++){
    var pKey = placeholders[j].getAttribute('data-i18n-placeholder');
    if (STRINGS[pKey]) placeholders[j].setAttribute('placeholder', STRINGS[pKey][Echo.lang]);
  }
  var toggles = document.querySelectorAll('.lang-toggle');
  for (var k = 0; k < toggles.length; k++){
    toggles[k].textContent = LANG_LABEL[Echo.lang];
  }
}

function toggleLang(){
  Echo.lang = Echo.lang === 'en' ? 'uk' : 'en';
  applyI18n();
  renderCirclesList();
  var c = Echo.current;
  if (c){
    setTag(els.drawCircleTag, c.category);
    if (c.flipped && Echo.currentQuestion){
      els.drawQuestionText.textContent = qText(Echo.currentQuestion);
    } else if (isPoolComplete(c)){
      els.drawTagline.textContent = STRINGS.storyCompleteTitle[Echo.lang];
      els.drawCompleteSubtitle.textContent = STRINGS.storyCompleteSubtitle[Echo.lang];
    } else if (!c.flipped){
      els.drawTagline.textContent = STRINGS.tagline[Echo.lang];
    }
  }
}

function toggleMute(){
  Echo.muted = !Echo.muted;
  els.drawVideo.muted = Echo.muted;
  var icon = Echo.muted ? ICON.soundOff : ICON.soundOn;
  var toggles = document.querySelectorAll('.mute-toggle .icon');
  for (var j = 0; j < toggles.length; j++){
    toggles[j].innerHTML = icon;
  }
}

/* ===== Delete circle ===== */
var pendingDeleteId = null;

function deleteSubText(name){
  return Echo.lang === 'en'
    ? 'You will permanently lose all notes and progress with ' + name + '.'
    : 'Ти назавжди втратиш усі нотатки й прогрес у діалозі з ' + name + '.';
}

function openDeleteModal(c){
  pendingDeleteId = c.id;
  els.deleteSubText.textContent = deleteSubText(c.name);
  els.deleteModal.classList.add('show');
}

function closeDeleteModal(){
  els.deleteModal.classList.remove('show');
  pendingDeleteId = null;
}

function doDeleteCircle(){
  if (!pendingDeleteId) return;
  var idToDelete = pendingDeleteId;
  Echo.circles = Echo.circles.filter(function(c){ return c.id !== idToDelete; });
  if (Echo.current && Echo.current.id === idToDelete) Echo.current = null;
  closeDeleteModal();
  goCircles();
  showToast(STRINGS.toastDeleted[Echo.lang]);
  if (supabase){
    supabase.from('circles').delete().eq('id', idToDelete).then(function(res){
      if (res.error) console.error('delete circle failed', res.error);
    });
  }
}

function growthStage(c){
  var p = pool(c);
  var pct = p.length ? (c.askedIds.length / p.length * 100) : 0;
  if (pct >= 80) return 5;
  if (pct >= 60) return 4;
  if (pct >= 40) return 3;
  if (pct >= 20) return 2;
  return 1;
}

function drawNextQuestion(c){
  var p = pool(c);
  var unseen = p.filter(function(q){ return c.askedIds.indexOf(q.i) === -1; });
  var source = unseen.length ? unseen : p;
  Echo.currentQuestion = source[Math.floor(Math.random() * source.length)];
}

function isPoolComplete(c){
  var p = pool(c);
  return p.length > 0 && c.askedIds.length >= p.length;
}

function findQuestionById(qid){
  for (var i = 0; i < QUESTIONS.length; i++){
    if (String(QUESTIONS[i].i) === String(qid)) return QUESTIONS[i];
  }
  return null;
}

/* ===== Video / growth choreography — exact behavior per growth-mechanic.md ===== */
function setVideoSrc(video, src, poster){
  if (video.getAttribute('data-src') !== src){
    video.setAttribute('data-src', src);
    video.src = src;
    if (poster) video.poster = poster;
  }
}

var preloadedVideoSrcs = {};
var preloadedVideoElements = [];
function preloadVideo(src){
  if (preloadedVideoSrcs[src]) return;
  preloadedVideoSrcs[src] = true;
  var v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.src = src;
  v.load();
  preloadedVideoElements.push(v);
}

function startIdleCycle(video, c){
  clearTimeout(growthTimer);
  function playOnce(){
    try { video.currentTime = 0; } catch(e){}
    var p = video.play();
    if (p && p.catch) p.catch(function(){});
  }
  video.onended = function(){
    if (c.flipped) return;
    growthTimer = setTimeout(function(){ if (!c.flipped) playOnce(); }, 5000);
  };
  playOnce();
}

function startCirclesIdleCycle(video){
  clearTimeout(circlesGrowthTimer);
  function playOnce(){
    try { video.currentTime = 0; } catch(e){}
    var p = video.play();
    if (p && p.catch) p.catch(function(){});
  }
  video.onended = function(){
    circlesGrowthTimer = setTimeout(playOnce, 5000);
  };
  playOnce();
}

function playTransitionThenIdle(video, c, newStage){
  video.onended = function(){
    video.onended = null;
    /* Hide the video across the src swap so the viewer never sees the raw
       cut between the transition clip's last frame and the idle clip's
       first frame — fade out during the existing pause, fade back in once
       the new source is already playing. */
    video.style.opacity = '0';
    setTimeout(function(){
      c.growthLevel = newStage;
      setVideoSrc(video, GROWTH.idle[newStage - 1], GROWTH.images[newStage - 1]);
      startIdleCycle(video, c);
      video.style.opacity = '1';
      if (newStage < 5) preloadVideo(GROWTH.transitions[newStage - 1]);
    }, 700);
  };
  var p = video.play();
  if (p && p.catch) p.catch(function(){});
}

function flipBackAndResume(c, growth, prevStage, newStage){
  clearTimeout(growthTimer);
  var video = els.drawVideo;
  if (growth){
    setVideoSrc(video, GROWTH.transitions[prevStage - 1], GROWTH.images[prevStage - 1]);
  }
  /* Reset to frame 0 now, while the card is still mid-flip and the video is
     hidden — not at reveal time. Otherwise the viewer sees a visible jump
     from wherever playback was paused back to frame 0 on every single
     flip-back, not just on growth transitions. */
  try { video.currentTime = 0; } catch(e){}
  video.pause();
  c.flipped = false;
  els.drawCard.classList.remove('flipped');
  setTimeout(function(){
    if (growth) playTransitionThenIdle(video, c, newStage);
    else startIdleCycle(video, c);
  }, FLIP_MS);
}

/* ===== Draw screen footer toggling ===== */
function showFrontFooter(){
  els.drawHelperText.style.display = 'block';
  els.drawActions.classList.remove('show');
  els.btnViewNotesComplete.style.display = 'none';
}
function showCompleteFooter(){
  els.drawHelperText.style.display = 'none';
  els.drawActions.classList.remove('show');
  els.btnViewNotesComplete.style.display = '';
}
function showBackFooter(){
  els.drawHelperText.style.display = 'none';
  els.drawActions.classList.add('show');
  els.btnViewNotesComplete.style.display = 'none';
}

function refreshDrawProgress(c){
  var p = pool(c);
  els.drawProgressLabel.textContent = c.askedIds.length + ' / ' + p.length;
  var pct = p.length ? (c.askedIds.length / p.length * 100) : 0;
  els.drawProgressFill.style.width = pct + '%';
}

function setTag(el, category){
  var m = TAGS[category] || TAGS.new;
  el.className = 'tag ' + m.cls;
  el.textContent = m[Echo.lang];
}

/* ===== Toast ===== */
var toastTimer = null;
function showToast(msg, opts){
  opts = opts || {};
  var onCircles = Echo.screen === 'circles';
  var onTop = onCircles || Echo.screen === 'auth';
  els.toast.textContent = msg;
  els.toast.classList.toggle('toast-top', onTop);
  if (els.circlesScreenContent) els.circlesScreenContent.classList.toggle('toast-space', onCircles);
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){
    els.toast.classList.remove('show');
    if (els.circlesScreenContent) els.circlesScreenContent.classList.remove('toast-space');
  }, opts.duration || 2600);
}

/* ===== Navigation ===== */
var SPLASH_MS = 1600;

function showScreen(name){
  els.screen_splash.classList.toggle('hidden', name !== 'splash');
  els.screen_auth.classList.toggle('hidden', name !== 'auth');
  els.screen_circles.classList.toggle('hidden', name !== 'circles');
  els.screen_newcircle.classList.toggle('hidden', name !== 'newcircle');
  els.screen_draw.classList.toggle('hidden', name !== 'draw');
  els.screen_notes.classList.toggle('hidden', name !== 'notes');
  Echo.screen = name;
}

function closeAllModals(){
  els.noteModal.classList.remove('show');
  els.deleteModal.classList.remove('show');
  els.drawMenuModal.classList.remove('show');
  noteEditQuestion = null;
  pendingDeleteId = null;
}

function goCircles(){
  clearTimeout(growthTimer);
  els.drawVideo.onended = null;
  els.drawVideo.pause();
  closeAllModals();
  renderCirclesList();
  showScreen('circles');
}

function goNewCircle(){
  resetNewCircleForm();
  showScreen('newcircle');
}

/* ===== Circles list rendering ===== */
function circleCardEl(c){
  var div = document.createElement('div');
  div.className = 'circle-card';
  var p = pool(c);
  var pct = p.length ? (c.askedIds.length / p.length * 100) : 0;
  var tag = TAGS[c.category] || TAGS.new;
  div.innerHTML =
    '<div class="circle-card-row">' +
      '<div class="circle-avatar"><span>' + escapeHtml(c.name.charAt(0).toUpperCase()) + '</span></div>' +
      '<div class="circle-info">' +
        '<div class="circle-name">' + escapeHtml(c.name) + '</div>' +
        '<span class="tag ' + tag.cls + '">' + tag[Echo.lang] + '</span>' +
      '</div>' +
      '<div class="circle-meta">' + c.askedIds.length + '/' + p.length + '</div>' +
    '</div>' +
    '<div class="progress-track"><div class="progress-fill" style="width:' + pct + '%"></div></div>';
  buildIconsIn(div);
  div.addEventListener('click', function(){ enterDraw(c.id); });
  return div;
}

function userFirstName(){
  var meta = Echo.session && Echo.session.user && Echo.session.user.user_metadata;
  var full = meta && (meta.full_name || meta.name);
  if (!full) return null;
  return full.trim().split(/\s+/)[0];
}

function emptyCardEl(){
  var div = document.createElement('div');
  div.className = 'circle-card-empty';
  var name = userFirstName();
  var greeting = name
    ? STRINGS.emptyGreetingName[Echo.lang].replace('{name}', escapeHtml(name))
    : STRINGS.emptyGreeting[Echo.lang];
  div.innerHTML =
    '<h2 class="voice">' + greeting + '</h2>' +
    '<p>' + STRINGS.emptyDesc[Echo.lang] + '</p>' +
    '<div class="divider"></div>' +
    '<button class="btn btn-primary btn-block" id="btn-empty-create"><span class="icon" data-icon="plus"></span>' + STRINGS.createDialog[Echo.lang] + '</button>';
  buildIconsIn(div);
  div.querySelector('#btn-empty-create').addEventListener('click', goNewCircle);
  return div;
}

function buildIconsIn(root){
  var nodes = root.querySelectorAll('[data-icon]');
  for (var i = 0; i < nodes.length; i++){
    var name = nodes[i].getAttribute('data-icon');
    if (ICON[name]) nodes[i].innerHTML = ICON[name];
  }
}

function mascotScaleFor(count){
  var minScale = 0.5;
  if (count <= 2) return 1;
  var scale = 1 - (count - 2) * 0.1;
  return Math.max(minScale, scale);
}

function renderCirclesList(){
  var wrap = els.circlesList;
  wrap.innerHTML = '';
  var isEmpty = !Echo.circles.length;
  if (isEmpty){
    wrap.appendChild(emptyCardEl());
  } else {
    Echo.circles.forEach(function(c){ wrap.appendChild(circleCardEl(c)); });
  }
  els.btnFabCreate.style.display = isEmpty ? 'none' : '';
  if (els.circlesScreenContent) els.circlesScreenContent.classList.toggle('no-mask', isEmpty);
  els.circlesMascot.style.setProperty('--mascot-scale', mascotScaleFor(Echo.circles.length));
  ensureCirclesMascotVideo();
}

function maxGrowthStage(){
  var max = 1;
  for (var i = 0; i < Echo.circles.length; i++){
    var s = growthStage(Echo.circles[i]);
    if (s > max) max = s;
  }
  return max;
}

function ensureCirclesMascotVideo(){
  var stage = maxGrowthStage();
  var newSrc = GROWTH.idle[stage - 1];
  var video = els.circlesMascot.querySelector('video');
  if (!video){
    els.circlesMascot.innerHTML = '<video muted playsinline preload="auto"></video>';
    video = els.circlesMascot.querySelector('video');
    setVideoSrc(video, newSrc, GROWTH.images[stage - 1]);
    startCirclesIdleCycle(video);
    return;
  }
  if (video.getAttribute('data-src') !== newSrc){
    setVideoSrc(video, newSrc, GROWTH.images[stage - 1]);
    startCirclesIdleCycle(video);
  }
}

/* ===== New circle form ===== */
function resetNewCircleForm(){
  els.inputName.value = '';
  els.nameError.classList.remove('show');
  els.inputName.style.borderColor = '';
  Echo.selectedCategory = 'new';
  var cards = els.optionList.querySelectorAll('.option-card');
  for (var i = 0; i < cards.length; i++){
    cards[i].classList.toggle('selected', cards[i].getAttribute('data-category') === 'new');
  }
  els.newcircleMascot.innerHTML = '<img src="' + NEW_DIALOG_IMAGE + '" alt="Іскрик">';
}

function onCreateCircle(){
  var name = els.inputName.value.trim();
  if (!name){
    els.nameError.classList.add('show');
    els.inputName.style.borderColor = 'var(--border-active)';
    els.inputName.focus();
    return;
  }
  if (!supabase || !Echo.session) return;
  supabase.from('circles').insert({
    user_id: Echo.session.user.id,
    name: name,
    category: Echo.selectedCategory || 'new'
  }).select().single().then(function(res){
    if (res.error || !res.data){
      console.error('create circle failed', res.error);
      return;
    }
    var circle = hydrateCircle(res.data, []);
    Echo.circles.push(circle);
    enterDraw(circle.id);
  });
}

/* ===== Draw screen ===== */
function showCompletedState(c){
  Echo.currentQuestion = null;
  els.drawTagline.textContent = STRINGS.storyCompleteTitle[Echo.lang];
  els.drawCompleteSubtitle.textContent = STRINGS.storyCompleteSubtitle[Echo.lang];
  els.drawCompleteSubtitle.style.display = 'block';
  els.drawCard.classList.add('completed');
  showCompleteFooter();
}

function hideCompletedState(){
  els.drawTagline.textContent = STRINGS.tagline[Echo.lang];
  els.drawCompleteSubtitle.style.display = 'none';
  els.drawCard.classList.remove('completed');
}

function enterDraw(id){
  var c = null;
  for (var i = 0; i < Echo.circles.length; i++){
    if (Echo.circles[i].id === id){ c = Echo.circles[i]; break; }
  }
  if (!c) return;

  closeAllModals();
  Echo.current = c;
  c.flipped = false;
  els.drawCard.classList.remove('flipped');
  els.drawCircleName.textContent = c.name;
  setTag(els.drawCircleTag, c.category);
  refreshDrawProgress(c);

  if (isPoolComplete(c)){
    showCompletedState(c);
  } else {
    hideCompletedState();
    drawNextQuestion(c);
    showFrontFooter();
  }

  var stage = growthStage(c);
  c.growthLevel = stage;
  els.drawVideo.muted = Echo.muted;
  setVideoSrc(els.drawVideo, GROWTH.idle[stage - 1], GROWTH.images[stage - 1]);
  startIdleCycle(els.drawVideo, c);
  if (stage < 5) preloadVideo(GROWTH.transitions[stage - 1]);

  showScreen('draw');
}

function flipToBack(){
  var c = Echo.current;
  if (!c || c.flipped || isPoolComplete(c)) return;
  els.drawVideo.pause();
  c.flipped = true;
  els.drawCard.classList.add('flipped');
  els.drawQuestionText.textContent = qText(Echo.currentQuestion);
  showBackFooter();
}

function onSkip(){
  var c = Echo.current;
  if (!c || !c.flipped) return;
  var stage = growthStage(c);
  showFrontFooter();
  flipBackAndResume(c, false, stage, stage);
  setTimeout(function(){ drawNextQuestion(c); }, FLIP_MS);
}

function onAnswered(){
  var c = Echo.current;
  if (!c || !c.flipped) return;
  var prevStage = growthStage(c);
  var qid = Echo.currentQuestion.i;
  var note = c.notes[String(qid)] || null;
  if (c.askedIds.indexOf(qid) === -1) c.askedIds.push(qid);
  var newStage = growthStage(c);
  var growth = newStage > prevStage;
  var complete = isPoolComplete(c);
  var forceFinalGrowth = complete && !growth;
  if (growth) preloadVideo(GROWTH.idle[newStage - 1]);
  if (forceFinalGrowth) preloadVideo(GROWTH.transitions[3]);
  refreshDrawProgress(c);
  if (complete) showCompleteFooter(); else showFrontFooter();
  if (forceFinalGrowth){
    /* Already at max stage from an earlier answer — still play the final
       growth transition as the completion reveal, rather than cutting
       straight to a static idle frame. */
    flipBackAndResume(c, true, 4, 5);
  } else {
    flipBackAndResume(c, growth, prevStage, newStage);
  }
  setTimeout(function(){
    if (complete) showCompletedState(c);
    else drawNextQuestion(c);
  }, FLIP_MS);
  if (growth) showToast(STRINGS.toastGrowth[Echo.lang]);
  if (growth){
    /* Defer the network write so it doesn't compete for bandwidth with the
       idle-video preload kicked off just above — that preload is what has
       to win the race for a smooth growth-transition handoff. */
    setTimeout(function(){ insertAnswer(c, qid, note); }, 1200);
  } else {
    insertAnswer(c, qid, note);
  }
}

var noteEditQuestion = null;
var noteEditIsHistoryEdit = false;

function onEditNote(){
  var c = Echo.current;
  if (!c || !c.flipped || !Echo.currentQuestion) return;
  noteEditQuestion = Echo.currentQuestion;
  noteEditIsHistoryEdit = false;
  els.noteText.value = c.notes[String(noteEditQuestion.i)] || '';
  els.noteModal.classList.add('show');
}

function openNoteEditorFor(question){
  var c = Echo.current;
  if (!c || !question) return;
  noteEditQuestion = question;
  noteEditIsHistoryEdit = true;
  els.noteText.value = c.notes[String(question.i)] || '';
  els.noteModal.classList.add('show');
}

function saveNote(){
  var c = Echo.current;
  if (c && noteEditQuestion){
    var key = String(noteEditQuestion.i);
    var val = els.noteText.value.trim();
    if (val) c.notes[key] = val;
    else delete c.notes[key];
    if (noteEditIsHistoryEdit){
      /* editing a past, already-asked question: history is append-only,
         so this persists as a fresh 'asked' row with the corrected note
         rather than mutating the earlier row. */
      insertAnswer(c, noteEditQuestion.i, val || null);
    }
  }
  closeNoteModal();
  if (Echo.screen === 'notes') renderNotesList();
}

function closeNoteModal(){
  els.noteModal.classList.remove('show');
  noteEditQuestion = null;
  noteEditIsHistoryEdit = false;
}

/* ===== Dialog menu ===== */
function openDrawMenu(){
  els.drawMenuModal.classList.add('show');
}

function closeDrawMenu(){
  els.drawMenuModal.classList.remove('show');
}

/* ===== Notes list ===== */
function noteItemsFor(c){
  var items = [];
  for (var key in c.notes){
    if (!Object.prototype.hasOwnProperty.call(c.notes, key)) continue;
    items.push({ question: findQuestionById(key), text: c.notes[key] });
  }
  return items;
}

function renderNotesList(){
  var c = Echo.current;
  var wrap = els.notesList;
  wrap.innerHTML = '';
  var items = c ? noteItemsFor(c) : [];
  if (!items.length){
    wrap.classList.add('empty');
    var title = document.createElement('p');
    title.className = 'notes-empty-title';
    title.textContent = STRINGS.notesEmptyTitle[Echo.lang];
    var subtitle = document.createElement('p');
    subtitle.className = 'notes-empty-subtitle';
    subtitle.textContent = STRINGS.notesEmptySubtitle[Echo.lang];
    wrap.appendChild(title);
    wrap.appendChild(subtitle);
    return;
  }
  wrap.classList.remove('empty');
  items.forEach(function(item){
    var div = document.createElement('div');
    div.className = 'note-item';
    var questionLabel = item.question ? qText(item.question) : '';
    div.innerHTML =
      '<div class="note-item-question">' + escapeHtml(questionLabel) + '</div>' +
      '<div class="note-item-text">' + escapeHtml(item.text) + '</div>';
    div.addEventListener('click', function(){ openNoteEditorFor(item.question); });
    wrap.appendChild(div);
  });
}

function goNotes(){
  if (!Echo.current) return;
  clearTimeout(growthTimer);
  els.drawVideo.onended = null;
  els.drawVideo.pause();
  els.notesCircleName.textContent = Echo.current.name;
  renderNotesList();
  showScreen('notes');
}

function backFromNotes(){
  var c = Echo.current;
  showScreen('draw');
  if (c) startIdleCycle(els.drawVideo, c);
}

/* ===== Wire up events ===== */
function bindEvents(){
  els.btnAuthMagicLink.addEventListener('click', sendMagicLink);
  els.btnAuthGoogle.addEventListener('click', signInWithGoogle);
  els.btnAuthGuest.addEventListener('click', continueAsGuest);
  els.authEmail.addEventListener('input', function(){
    els.authEmailError.classList.remove('show');
    els.authEmail.style.borderColor = '';
  });
  els.authEmail.addEventListener('keydown', function(e){
    if (e.key === 'Enter') sendMagicLink();
  });
  els.btnSignOut.addEventListener('click', signOut);

  els.btnFabCreate.addEventListener('click', goNewCircle);
  els.btnBackToCircles.addEventListener('click', goCircles);
  els.btnBackToCircles2.addEventListener('click', goCircles);
  els.btnCreateCircle.addEventListener('click', onCreateCircle);

  var langToggles = document.querySelectorAll('.lang-toggle');
  for (var t = 0; t < langToggles.length; t++){
    langToggles[t].addEventListener('click', toggleLang);
  }

  var muteToggles = document.querySelectorAll('.mute-toggle');
  for (var m = 0; m < muteToggles.length; m++){
    muteToggles[m].addEventListener('click', toggleMute);
  }

  els.inputName.addEventListener('input', function(){
    els.nameError.classList.remove('show');
    els.inputName.style.borderColor = '';
  });
  els.inputName.addEventListener('keydown', function(e){
    if (e.key === 'Enter') onCreateCircle();
  });

  els.optionList.addEventListener('click', function(e){
    var card = e.target.closest('.option-card');
    if (!card) return;
    var cards = els.optionList.querySelectorAll('.option-card');
    for (var i = 0; i < cards.length; i++) cards[i].classList.remove('selected');
    card.classList.add('selected');
    Echo.selectedCategory = card.getAttribute('data-category');
  });

  els.drawCard.addEventListener('click', function(){
    var c = Echo.current;
    if (!c) return;
    if (c.flipped) onSkip(); else flipToBack();
  });
  els.btnSkip.addEventListener('click', onSkip);
  els.btnAnswered.addEventListener('click', onAnswered);
  els.btnViewNotesComplete.addEventListener('click', goNotes);
  els.btnEditNote.addEventListener('click', function(e){ e.stopPropagation(); onEditNote(); });

  els.btnNoteSave.addEventListener('click', saveNote);
  els.btnNoteClose.addEventListener('click', closeNoteModal);

  els.btnDrawMenu.addEventListener('click', openDrawMenu);
  els.btnMenuClose.addEventListener('click', closeDrawMenu);
  els.btnMenuNotes.addEventListener('click', function(){ closeDrawMenu(); goNotes(); });
  els.btnMenuLang.addEventListener('click', function(){ closeDrawMenu(); toggleLang(); });
  els.btnMenuDelete.addEventListener('click', function(){
    closeDrawMenu();
    if (Echo.current) openDeleteModal(Echo.current);
  });
  els.btnBackToDraw.addEventListener('click', backFromNotes);

  els.btnDeleteClose.addEventListener('click', closeDeleteModal);
  els.btnDeleteCancel.addEventListener('click', closeDeleteModal);
  els.btnDeleteConfirm.addEventListener('click', doDeleteCircle);
}

function init(){
  cacheEls();
  buildIcons();
  bindEvents();
  applyI18n();
  els.authMascot.innerHTML = '<img src="' + AUTH_MASCOT_IMAGE + '" alt="Іскрик">';
  showScreen('splash');
  loadSupabase();
  setTimeout(function(){
    splashTimerDone = true;
    maybeLeaveSplash();
  }, SPLASH_MS);
}

if (document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();
