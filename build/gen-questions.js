const fs = require('fs');

const source = require('./questions_source.json').questions;

// Friendship-stage questions are not part of the provided dataset (only
// getting_to_know / relationship exist there), so per the "придумай самостійно"
// instruction these are authored here, bilingual, continuing the id sequence.
const friendship = [
  { id: 151, uk: 'Яка моя риса тобі подобається найбільше, але ти рідко мені про це кажеш?', en: 'Which of my traits do you like the most, but rarely tell me about?' },
  { id: 152, uk: 'Який наш спільний момент ти згадуєш найчастіше?', en: 'Which shared moment of ours do you think about the most?' },
  { id: 153, uk: 'У який момент ти зрозумів(ла), що ми справді стали друзями?', en: 'At what point did you realize we had really become friends?' },
  { id: 154, uk: 'Що ти думаєш про мене такого, чого, як тобі здається, я про себе не знаю?', en: "What do you think about me that you believe I don't know about myself?" },
  { id: 155, uk: 'Якби ми познайомилися тільки зараз, думаєш, ми б подружилися?', en: 'If we met only now, do you think we would become friends?' },
  { id: 156, uk: 'За що ти міг(могла) б на мене образитися, але, можливо, ніколи прямо не сказав(ла) б про це?', en: "What might you get hurt by from me, but maybe would never say directly?" },
  { id: 157, uk: 'Яка моя дивна звичка викликає в тебе найбільшу усмішку?', en: 'Which weird habit of mine makes you smile the most?' },
  { id: 158, uk: 'Якби нашій дружбі потрібно було дати назву, якою б вона була?', en: 'If our friendship needed a name, what would it be?' },
  { id: 159, uk: 'У якій ситуації ти знаєш, що можеш на мене розраховувати?', en: 'In what situation do you know you can count on me?' },
  { id: 160, uk: 'Що б ти хотів(ла), щоб у нашій дружбі було частіше?', en: 'What would you like there to be more of in our friendship?' },
  { id: 161, uk: 'Якби ми могли повторити один день із нашого минулого, який би ти обрав(ла)?', en: 'If we could relive one day from our past, which one would you choose?' },
  { id: 162, uk: 'Яку мою версію ти пам’ятаєш найяскравіше?', en: 'Which version of me do you remember most vividly?' },
  { id: 163, uk: 'Чи змінив(ла) я тебе чимось, навіть зовсім трохи?', en: 'Have I changed you in any way, even just a little?' },
  { id: 164, uk: 'У чому ми абсолютно різні, але саме тому добре доповнюємо одне одного?', en: "In what way are we completely different, but that's exactly why we complement each other well?" },
  { id: 165, uk: 'Якби наше знайомство було фільмом, який це був би жанр?', en: 'If our friendship were a movie, what genre would it be?' },
  { id: 166, uk: 'Яку пригоду ти обов’язково хотів(ла) б пережити разом зі мною?', en: 'What adventure would you definitely want to experience together with me?' },
  { id: 167, uk: 'Коли востаннє ти відчував(ла), що тебе справді розуміють?', en: 'When did you last feel truly understood?' },
  { id: 168, uk: 'Що зараз відбувається у твоєму житті такого, про що тобі хотілося б поговорити більше?', en: "What's happening in your life right now that you'd like to talk about more?" },
  { id: 169, uk: 'Яку пораду ти дав(ла) б собі п’ять років тому?', en: 'What advice would you give yourself five years ago?' },
  { id: 170, uk: 'Як ти думаєш, якою буде наша дружба через десять років?', en: 'What do you think our friendship will be like in ten years?' }
];

const stageCode = { getting_to_know: 'g', relationship: 'r' };

const merged = source
  .map(q => ({ i: q.id, s: stageCode[q.stage], uk: q.uk, en: q.en }))
  .concat(friendship.map(q => ({ i: q.id, s: 'f', uk: q.uk, en: q.en })));

const parts = merged.map(q =>
  '{i:' + q.i + ',s:' + JSON.stringify(q.s) + ',uk:' + JSON.stringify(q.uk) + ',en:' + JSON.stringify(q.en) + '}'
);

fs.writeFileSync('questions.js', 'const QUESTIONS=[' + parts.join(',') + '];\n', 'utf8');
console.log('wrote questions.js, total:', merged.length);
