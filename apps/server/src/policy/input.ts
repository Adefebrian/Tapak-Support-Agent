// Deterministic pre-LLM policy. Pure functions over the customer's text, so every rule is unit-testable.

export type Intent = "policy_question" | "order_status" | "action_request" | "complaint" | "out_of_scope";
export type Action = "answer" | "clarify" | "refuse" | "escalate";
export type Priority = "normal" | "high";

// Higher number = more conservative. Used to merge rule, LLM, and JEV opinions.
export const INTENT_RISK: Record<Intent, number> = {
  policy_question: 0,
  order_status: 1,
  out_of_scope: 2,
  action_request: 3,
  complaint: 4,
};
export const ACTION_RISK: Record<Action, number> = { answer: 0, clarify: 1, refuse: 2, escalate: 3 };

export function riskierIntent(a: Intent, b: Intent): Intent {
  return INTENT_RISK[b] > INTENT_RISK[a] ? b : a;
}
export function riskierAction(a: Action, b: Action): Action {
  return ACTION_RISK[b] > ACTION_RISK[a] ? b : a;
}

export const ORDER_ID_RE = /\bTPK[-\s]?(\d{5})\b/gi;
export const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function normalizeOrderId(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return `TPK-${digits}`;
}
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function extractOrderIds(text: string): string[] {
  return [...new Set([...text.matchAll(ORDER_ID_RE)].map((m) => normalizeOrderId(m[0])))];
}
export function extractEmails(text: string): string[] {
  return [...new Set((text.match(EMAIL_RE) ?? []).map(normalizeEmail))];
}

const INJECTION_PATTERNS: [string, RegExp][] = [
  [
    "ignore_instructions",
    /\b(ignore|disregard|forget)\b.{0,30}\b(previous|above|prior|all|your)\b.{0,20}\b(instructions?|rules?|prompts?)\b/i,
  ],
  ["role_override", /\b(you are now|act as|pretend (to be|you are)|from now on you)\b/i],
  [
    "system_prompt_probe",
    /\b(system prompt|developer message|hidden instructions?|reveal your (prompt|instructions))\b/i,
  ],
  ["mode_switch", /\b(developer mode|admin mode|debug mode|jailbreak|DAN)\b/],
  [
    "judge_targeting",
    /\b(rate|score|classify|mark)\b.{0,30}\b(as safe|as low risk|score\s*0|0 risk|not escalat)/i,
  ],
  ["tool_forcing", /\b(call|run|execute|invoke)\b.{0,20}\b(get_order|refund|cancel_order|tool|function)\b/i],
  [
    "fake_authority",
    /\b(i am|this is) (an? )?(admin|administrator|developer|staff|manager|support agent|anthropic|openai)\b/i,
  ],
];

export function detectInjection(text: string): string[] {
  return INJECTION_PATTERNS.filter(([, re]) => re.test(text)).map(([name]) => name);
}

const HIGH_PRIORITY =
  /\b(chargeback|charge back|dispute (the|this|my) (charge|payment)|lawyer|legal action|sue|suing|court|police|consumer protection|ylki|scam|fraud|unacceptable|furious|ridiculous|worst (service|company|store)|never (buy|shop|order) (here|again|from you))\b/i;
const MEDICAL =
  /\b(plantar|fasciitis|medical|doctor|podiatrist|orthopedic|orthotic|injur(y|ies|ed)|diabet(es|ic)|bunion|arthritis|pregnan(t|cy)|knee pain|back pain|heel pain|foot pain|therapy|prescription|swollen|allerg(y|ic))\b/i;
const LEGAL_SAFETY = /\b(is it (legal|safe) to|safety certified|toxic|chemical burn|catch fire|flammable)\b/i;
const EXCEPTION =
  /\b(exception|make an exception|past (the )?30 days|after (the )?30 days|\d{2,3} days (ago|late)|over (the )?30 days|late return|bend the rule|just this once)\b/i;
const ACTION_VERB =
  /\b(refund|cancel|change (my |the )?(delivery |shipping )?address|update (my |the )?address|exchange|swap|replace|replacement|return (it|them|this|these|my)|send (it|them) back|money back|reimburse|compensat)/i;
const FIRST_PERSON_DEMAND =
  /\b(i want|i'd like|i would like|i need|please|can you|could you|i demand|give me|process|issue|start (a|my))\b/i;
// "my shoes" alone is not order talk ("my shoes look dirty" is a care question, defect D-06);
// it only counts when paired with a delivery verb.
const ORDER_TALK =
  /\b(my order|my package|my parcel|order status|where is|where's|track(ing)?|(has|have)(n't| not) (arrived|come)|not arrived|didn't (arrive|come)|never (arrived|came)|still waiting|not (yet )?(here|received)|when will (it|my|they)|belum sampai|shipment|delivered\?)/i;
const GREETING_ONLY = /^\s*(hi|hello|hey|halo|good (morning|afternoon|evening))[\s!.]*$/i;
const NEGATIVE =
  /\b(angry|upset|terrible|awful|disappointed|frustrated|annoyed|horrible|garbage|trash|wtf)\b/i;

export type InputAnalysis = {
  length: number;
  injectionFlags: string[];
  orderIds: string[];
  emails: string[];
  intent: Intent;
  medical: boolean;
  legalSafety: boolean;
  highPriority: boolean;
  negativeTone: boolean;
  policyException: boolean;
  actionRequested: boolean;
  orderTalk: boolean;
  greeting: boolean;
};

export function analyzeInput(text: string): InputAnalysis {
  const orderIds = extractOrderIds(text);
  const emails = extractEmails(text);
  const medical = MEDICAL.test(text);
  const legalSafety = LEGAL_SAFETY.test(text);
  const highPriority = HIGH_PRIORITY.test(text);
  const negativeTone = NEGATIVE.test(text);
  const policyException = EXCEPTION.test(text);
  const hasActionVerb = ACTION_VERB.test(text);
  const actionRequested =
    policyException ||
    (hasActionVerb &&
      (FIRST_PERSON_DEMAND.test(text) || orderIds.length > 0 || /\bmy (order|shoes|pair)\b/i.test(text)));
  // A bare email or order ID is a verification follow-up, not a policy question (defect D-03).
  const orderTalk = ORDER_TALK.test(text) || orderIds.length > 0 || emails.length > 0;

  let intent: Intent = "policy_question";
  if (highPriority) intent = "complaint";
  else if (actionRequested) intent = "action_request";
  else if (medical || legalSafety) intent = "out_of_scope";
  else if (orderTalk) intent = "order_status";

  return {
    length: text.length,
    injectionFlags: detectInjection(text),
    orderIds,
    emails,
    intent,
    medical,
    legalSafety,
    highPriority,
    negativeTone,
    policyException,
    actionRequested,
    orderTalk,
    greeting: GREETING_ONLY.test(text),
  };
}

export type ActionKind = "refund" | "cancel" | "address_change" | "exchange" | "policy_exception" | "other";

export function actionKind(text: string): ActionKind {
  if (EXCEPTION.test(text)) return "policy_exception";
  if (/\bcancel/i.test(text)) return "cancel";
  if (/\baddress\b/i.test(text)) return "address_change";
  if (/\b(exchange|swap|different size|another size)\b/i.test(text)) return "exchange";
  if (/\b(refund|money back|return|reimburse|send (it|them) back)\b/i.test(text)) return "refund";
  return "other";
}
