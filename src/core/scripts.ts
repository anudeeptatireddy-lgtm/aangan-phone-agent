// Caller-facing wording. English approved by the project owner 2026-10-07 (Nikhil production sign-off pending).
// Hindi/Marathi price explanation supplied by the owner: front desk must native-check before go-live.
// Other Hindi/Marathi lines are drafts pending native review. NO script may contain a price, rate or amount.

export type Locale = "en" | "hi" | "mr";
export type ScriptStatus = "approved" | "approved_pending_native_check" | "draft_pending_native_review" | "draft_not_approved";
export interface Script { text: string; status: ScriptStatus }
type Trio = Record<Locale, Script>;

const A = (text: string): Script => ({ text, status: "approved" });
const N = (text: string): Script => ({ text, status: "approved_pending_native_check" });
const D = (text: string): Script => ({ text, status: "draft_pending_native_review" });
const X = (text: string): Script => ({ text, status: "draft_not_approved" });

export const SCRIPTS = {
  price_explanation: {
    en: A("I can't give you a figure that would mean anything before a designer sees your home. The same kitchen can cost several times more depending on the materials. The consultation is free, and by the end of it the designer will give you a proper number."),
    hi: N("डिज़ाइनर के घर देखे बिना कोई भी आंकड़ा बताना सही नहीं होगा। एक ही किचन, मटीरियल के हिसाब से, कई गुना महँगा हो सकता है। कंसल्टेशन बिल्कुल फ्री है, और उसके आख़िर में डिज़ाइनर आपको सही आंकड़ा बताएँगे।"),
    mr: N("डिझायनरने घर पाहिल्याशिवाय कोणताही आकडा सांगणं योग्य होणार नाही. एकच किचन, मटेरियलनुसार, कितीतरी पट महाग होऊ शकतं. कन्सल्टेशन पूर्णपणे मोफत आहे, आणि त्याच्या शेवटी डिझायनर तुम्हाला नेमका आकडा सांगतील."),
  },
  "not_fit.area": {
    en: A("Thank you for thinking of us. We only take projects in Pune and PCMC, because our contractors need to be on site every day. I'm sorry we can't help with this one."),
    hi: D("हमें याद करने के लिए धन्यवाद। हम केवल पुणे और पिंपरी-चिंचवड में प्रोजेक्ट लेते हैं, क्योंकि हमारे कॉन्ट्रैक्टर्स को रोज़ साइट पर रहना पड़ता है। माफ़ कीजिए, इस प्रोजेक्ट में हम मदद नहीं कर पाएँगे।"),
    mr: D("आमची आठवण ठेवल्याबद्दल धन्यवाद. आम्ही फक्त पुणे आणि पिंपरी-चिंचवडमध्ये प्रोजेक्ट घेतो, कारण आमच्या कॉन्ट्रॅक्टर्सना रोज साइटवर असावं लागतं. क्षमस्व, या प्रोजेक्टमध्ये आम्ही मदत करू शकत नाही."),
  },
  "not_fit.advisory": {
    en: A("We're a full-service studio, so every project includes design and execution together. We don't do advice-only visits. If you decide on a full project, we'd love to hear from you."),
    hi: D("हम एक फुल-सर्विस स्टूडियो हैं, इसलिए हर प्रोजेक्ट में डिज़ाइन और एक्ज़िक्यूशन साथ-साथ होते हैं। हम सिर्फ़ सलाह वाली विज़िट नहीं करते। अगर आप पूरा प्रोजेक्ट करवाने का फ़ैसला करें, तो हमें ज़रूर याद कीजिएगा।"),
    mr: D("आम्ही फुल-सर्व्हिस स्टुडिओ आहोत, त्यामुळे प्रत्येक प्रोजेक्टमध्ये डिझाइन आणि एक्झिक्यूशन एकत्र असतं. आम्ही फक्त सल्ला देणाऱ्या भेटी करत नाही. तुम्ही पूर्ण प्रोजेक्ट करायचं ठरवलंत, तर आम्हाला नक्की संपर्क करा."),
  },
  "not_fit.type": {
    en: A("We focus on homes and offices. A space like this has specialist requirements, so a studio that specialises in them will serve you better. I'm sorry we can't take it on."),
    hi: D("हम घरों और ऑफ़िसों पर ध्यान देते हैं। इस तरह की जगह की ख़ास ज़रूरतें होती हैं, इसलिए इसमें विशेषज्ञता वाला स्टूडियो आपके लिए बेहतर रहेगा। माफ़ कीजिए, हम इसे नहीं ले पाएँगे।"),
    mr: D("आम्ही घरे आणि ऑफिसेसवर लक्ष केंद्रित करतो. अशा जागेच्या विशेष गरजा असतात, त्यामुळे त्यात तज्ज्ञ असलेला स्टुडिओ तुमच्यासाठी अधिक योग्य ठरेल. क्षमस्व, आम्ही हे घेऊ शकत नाही."),
  },
  "not_fit.size_small": {
    en: A("Our office projects start at about 500 square feet, because our team is set up for that scale. A designer who specialises in compact spaces will be a better fit."),
    hi: D("हमारे ऑफ़िस प्रोजेक्ट लगभग 500 वर्ग फ़ुट से शुरू होते हैं, क्योंकि हमारी टीम उसी स्केल के लिए बनी है। छोटी जगहों में विशेषज्ञता रखने वाला डिज़ाइनर आपके लिए बेहतर रहेगा।"),
    mr: D("आमचे ऑफिस प्रोजेक्ट साधारण 500 चौरस फुटांपासून सुरू होतात, कारण आमची टीम त्या प्रमाणासाठी तयार आहे. लहान जागांमध्ये तज्ज्ञ असलेला डिझायनर तुमच्यासाठी अधिक योग्य ठरेल."),
  },
  "not_fit.size_large": {
    en: A("Our office projects go up to about 3,000 square feet, so a space this size needs a larger commercial team than ours. I'm sorry we can't take it on."),
    hi: D("हमारे ऑफ़िस प्रोजेक्ट लगभग 3,000 वर्ग फ़ुट तक के होते हैं, इसलिए इतनी बड़ी जगह के लिए हमारी टीम से बड़ी कमर्शियल टीम चाहिए। माफ़ कीजिए, हम इसे नहीं ले पाएँगे।"),
    mr: D("आमचे ऑफिस प्रोजेक्ट साधारण 3,000 चौरस फुटांपर्यंत असतात, त्यामुळे एवढ्या मोठ्या जागेसाठी आमच्यापेक्षा मोठी कमर्शियल टीम लागेल. क्षमस्व, आम्ही हे घेऊ शकत नाही."),
  },
  "not_fit.timeline": {
    en: A("To do this properly, design takes three to four weeks and a room takes at least eight to ten weeks end to end, so we couldn't do justice to your date. If you can start a little later, I can book you in now. Would that work?"),
    hi: D("इसे ठीक से करने के लिए डिज़ाइन में तीन से चार हफ़्ते और एक कमरे के लिए शुरू से अंत तक कम से कम आठ से दस हफ़्ते लगते हैं, इसलिए आपकी तारीख़ के साथ हम न्याय नहीं कर पाएँगे। अगर आप थोड़ा देर से शुरू कर सकें, तो हम अभी आपकी बुकिंग कर सकते हैं। क्या यह चलेगा?"),
    mr: D("हे नीट करण्यासाठी डिझाइनला तीन ते चार आठवडे आणि एका खोलीसाठी सुरुवातीपासून शेवटपर्यंत किमान आठ ते दहा आठवडे लागतात, त्यामुळे तुमच्या तारखेला आम्ही न्याय देऊ शकणार नाही. तुम्ही थोडं उशिरा सुरू करू शकलात, तर आम्ही आत्ताच बुकिंग करू शकतो. चालेल का?"),
  },
  "not_fit.wardrobe_only": {
    en: A("Our projects start at a full room with design and execution, so a single wardrobe is smaller than we can do well. A local modular carpentry firm will serve you better."),
    hi: D("हमारे प्रोजेक्ट एक पूरे कमरे के डिज़ाइन और एक्ज़िक्यूशन से शुरू होते हैं, इसलिए सिर्फ़ एक वार्डरोब हमारे लिए बहुत छोटा काम है जिसे हम अच्छे से कर सकें। कोई स्थानीय मॉड्यूलर कारपेंट्री फ़र्म आपके लिए बेहतर रहेगी।"),
    mr: D("आमचे प्रोजेक्ट एका पूर्ण खोलीच्या डिझाइन आणि एक्झिक्यूशनपासून सुरू होतात, त्यामुळे फक्त एक वॉर्डरोब आमच्यासाठी खूप लहान काम आहे. एखादी स्थानिक मॉड्युलर कारपेंट्री फर्म तुमच्यासाठी अधिक योग्य ठरेल."),
  },
  "not_fit.rental_structural": {
    en: A("Because it's a rented home, we keep all work reversible and don't change walls. If you'd like a design within that, I can book a consultation now."),
    hi: D("क्योंकि यह किराए का घर है, हम सारा काम रिवर्सिबल रखते हैं और दीवारों में बदलाव नहीं करते। अगर आप इसी दायरे में डिज़ाइन चाहें, तो हम अभी कंसल्टेशन बुक कर सकते हैं।"),
    mr: D("हे भाड्याचं घर असल्यामुळे आम्ही सगळं काम रिव्हर्सिबल ठेवतो आणि भिंतींमध्ये बदल करत नाही. याच मर्यादेत डिझाइन हवं असेल, तर आम्ही आत्ता कन्सल्टेशन बुक करू शकतो."),
  },
  expect_call: {
    en: A("I've passed your details to our team. Someone will call you during working hours, Monday to Friday, 10am to 7pm, {when}."),
    hi: D("मैंने आपकी जानकारी हमारी टीम को भेज दी है। कोई सोमवार से शुक्रवार, सुबह 10 से शाम 7 बजे के बीच, {when} आपको कॉल करेगा।"),
    mr: D("मी तुमची माहिती आमच्या टीमकडे दिली आहे. कोणीतरी सोमवार ते शुक्रवार, सकाळी 10 ते संध्याकाळी 7 या वेळेत, {when} तुम्हाला कॉल करेल."),
  },
  complaint_in_hours: {
    en: A("I'm sorry this has happened. I'm connecting you to a senior member of our team now."),
    hi: D("जो हुआ उसके लिए मुझे खेद है। आपको अभी हमारी सीनियर टीम से जोड़ा जा रहा है।"),
    mr: D("हे घडलं त्याबद्दल मला खेद आहे. तुम्हाला आत्ता आमच्या वरिष्ठ टीमशी जोडलं जात आहे."),
  },
  complaint_after_hours: {
    en: A("I'm sorry this has happened. I've flagged it to our senior team, and a senior person will call you by 10am {when}. You won't need to explain it again."),
    hi: D("जो हुआ उसके लिए मुझे खेद है। मैंने इसे हमारी सीनियर टीम को बता दिया है, और {when} सुबह 10 बजे तक कोई सीनियर व्यक्ति आपको कॉल करेगा। आपको दोबारा सब कुछ समझाने की ज़रूरत नहीं होगी।"),
    mr: D("हे घडलं त्याबद्दल मला खेद आहे. मी हे आमच्या वरिष्ठ टीमला कळवलं आहे, आणि {when} सकाळी 10 वाजेपर्यंत एक वरिष्ठ व्यक्ती तुम्हाला कॉल करेल. तुम्हाला पुन्हा सगळं समजावून सांगावं लागणार नाही."),
  },
  // Not supplied by Nikhil: drafted by the build team, needs approval before go-live.
  human_requested_in_hours: {
    en: X("Of course. I'm a virtual assistant, so let me connect you to someone on our team now."),
    hi: X("बिल्कुल। मैं एक वर्चुअल असिस्टेंट हूँ, इसलिए आपको अभी हमारी टीम के किसी व्यक्ति से जोड़ता हूँ।"),
    mr: X("नक्कीच. मी एक व्हर्च्युअल असिस्टंट आहे, त्यामुळे तुम्हाला आत्ता आमच्या टीममधील एखाद्या व्यक्तीशी जोडतो."),
  },
  human_requested_after_hours: {
    en: X("Of course. I'm a virtual assistant, and our team is not available right now. I've passed your details on and someone will call you during working hours, Monday to Friday, 10am to 7pm, {when}."),
    hi: X("बिल्कुल। मैं एक वर्चुअल असिस्टेंट हूँ और हमारी टीम अभी उपलब्ध नहीं है। मैंने आपकी जानकारी आगे भेज दी है, और कोई सोमवार से शुक्रवार, सुबह 10 से शाम 7 बजे के बीच, {when} आपको कॉल करेगा।"),
    mr: X("नक्कीच. मी एक व्हर्च्युअल असिस्टंट आहे आणि आमची टीम सध्या उपलब्ध नाही. मी तुमची माहिती पुढे दिली आहे, आणि कोणीतरी सोमवार ते शुक्रवार, सकाळी 10 ते संध्याकाळी 7 या वेळेत, {when} तुम्हाला कॉल करेल."),
  },
} satisfies Record<string, Trio>;
export type ScriptKey = keyof typeof SCRIPTS;

const REASON_TO_SCRIPT: Record<string, ScriptKey> = {
  area_outside_service: "not_fit.area",
  advisory_only: "not_fit.advisory",
  type_not_served: "not_fit.type",
  size_too_small: "not_fit.size_small",
  size_too_large: "not_fit.size_large",
  timeline_too_short: "not_fit.timeline",
  wardrobe_only: "not_fit.wardrobe_only",
  rental_structural: "not_fit.rental_structural",
  structural_offer_reversible: "not_fit.rental_structural",
};
export const scriptKeyForReason = (reason: string): ScriptKey | undefined => REASON_TO_SCRIPT[reason];

const DAY: Record<Locale, Record<string, string>> = {
  en: { Monday: "on Monday", Tuesday: "on Tuesday", Wednesday: "on Wednesday", Thursday: "on Thursday", Friday: "on Friday", Saturday: "on Saturday", Sunday: "on Sunday" },
  hi: { Monday: "सोमवार को", Tuesday: "मंगलवार को", Wednesday: "बुधवार को", Thursday: "गुरुवार को", Friday: "शुक्रवार को", Saturday: "शनिवार को", Sunday: "रविवार को" },
  mr: { Monday: "सोमवारी", Tuesday: "मंगळवारी", Wednesday: "बुधवारी", Thursday: "गुरुवारी", Friday: "शुक्रवारी", Saturday: "शनिवारी", Sunday: "रविवारी" },
};
const TODAY: Record<Locale, string> = { en: "today", hi: "आज", mr: "आज" };

export interface ScriptVars { when?: "today" | "day"; day?: string }

export function renderScript(key: string, locale: Locale, vars: ScriptVars = {}): string {
  const s = (SCRIPTS as Record<string, Trio | undefined>)[key]?.[locale];
  if (!s) throw new Error(`Unknown script ${key}/${locale}`);
  const isDay = vars.when === "day" || (vars.when === undefined && !!vars.day);
  const when = isDay && vars.day ? (DAY[locale][vars.day] ?? vars.day) : TODAY[locale];
  return s.text.replace("{when}", when);
}
