/**
 * Hand-written patterns for the attack families seen in the wild. They are precise rather than
 * broad: the classifier catches paraphrases, these catch the well-known phrasings with certainty
 * and explain themselves. All of them run on unmasked, lower-case text (see normalize.ts).
 */

import type { Category, Severity } from "./types";

export type Rule = { id: string; category: Category; severity: Severity; pattern: RegExp; why: string; contextOnly?: boolean };

const W = "[a-z']+"; // any one word
const ANY = `(?:${W}\\s+){0,4}`; // up to four filler words

export const RULES: Rule[] = [
  // Overriding the app's own instructions.
  {
    id: "override.ignore-previous",
    category: "injection",
    severity: "high",
    pattern: new RegExp(`\\b(ignore|disregard|forget|override|skip|bypass|discard)\\s+${ANY}(previous|prior|above|earlier|preceding|original|system|initial|all|any|your|the)\\s+${ANY}(instructions?|prompts?|rules|directions|guidelines|directives|commands?|constraints)\\b`),
    why: "Tells the model to ignore the instructions it was given, the classic prompt injection.",
  },
  {
    id: "override.new-instructions",
    category: "injection",
    severity: "high",
    pattern: /\b(new|updated|real|actual|revised) (system )?(instructions?|rules|task|directive)s?\s*(:|are|is|follow)/,
    why: "Announces replacement instructions, to swap out the app's real ones.",
  },
  {
    id: "override.from-now-on",
    category: "injection",
    severity: "medium",
    pattern: /\b(from now on|starting now|for the rest of (this|the) conversation),? (you|your|always|never|only|respond|answer|reply)\b/,
    why: "Tries to change how the model behaves for the rest of the conversation.",
  },
  {
    id: "override.fake-delimiter",
    category: "injection",
    severity: "high",
    pattern: /(<\/?\s*(system|assistant|instructions?)\s*>|\[\/?inst\]|<\|im_(start|end)\|>|###\s*(system|instruction)|\bend of (system )?prompt\b|-----\s*begin (system|new))/,
    why: "Fakes the markers a chat model uses to separate its system instructions from user text.",
  },
  {
    id: "override.priority-claim",
    category: "injection",
    severity: "medium",
    pattern: /\b(this (instruction|message|note) (takes|has) (priority|precedence)|highest priority (instruction|override)|admin(istrator)? override|developer override|maintenance mode)\b/,
    why: "Claims a higher authority than the app's instructions.",
  },

  // Persona and safety bypass.
  {
    id: "jailbreak.persona",
    category: "jailbreak",
    severity: "high",
    pattern: /\b(you are now|act as|pretend (to be|you are)|roleplay as|you will be)\s+(a |an )?(dan|stan|dude|aim|unfiltered|uncensored|jailbroken|evil|unrestricted|developer mode|god mode|an ai (without|with no))/,
    why: "Asks the model to become a persona that has no rules (DAN-style jailbreak).",
  },
  {
    id: "jailbreak.do-anything-now",
    category: "jailbreak",
    severity: "high",
    pattern: /\b(do anything now|developer mode (is )?(enabled|activated)(?! on (your|the|my) (phone|device|android))|(you are|you're) (now )?in developer mode|jailbreak(ed)? mode|dan mode|god mode (enabled|on))\b/,
    why: "Uses well-known jailbreak trigger phrases.",
  },
  {
    id: "jailbreak.no-rules",
    category: "jailbreak",
    severity: "medium",
    pattern: /\b(without|no|free (of|from)|ignore( all| your)?) (any )?(restrictions|filters|limitations|censorship|guidelines|safety (rules|guidelines|filters)|ethical (guidelines|constraints)|content polic(y|ies))\b(?! (in|for) (the|our) (database|query|search))/,
    why: "Asks the model to answer without its safety rules.",
  },
  {
    id: "jailbreak.hypothetical-wrapper",
    category: "jailbreak",
    severity: "low",
    pattern: /\b(in a (fictional|hypothetical) world where (there are no|ai has no|you have no) (rules|restrictions|limits))\b/,
    why: "Wraps a forbidden request in a story that claims rules don't apply.",
  },

  // Getting the system prompt out.
  {
    id: "leak.reveal-prompt",
    category: "prompt-leak",
    severity: "high",
    pattern: new RegExp(`\\b(reveal|show|print|output|repeat|display|tell me|give me|share|write out|leak|dump|recite|spell out|what (is|are|were))\\s+${ANY}(system|initial|original|hidden|secret|developer|internal|first)\\s+(prompt|instructions?|message|rules|configuration)`),
    why: "Asks for the hidden system prompt, which often contains business rules or secrets.",
  },
  {
    id: "leak.repeat-above",
    category: "prompt-leak",
    severity: "high",
    pattern: /\b(repeat|print|output|copy|translate|summari[sz]e) (everything|all|the (text|words|content)) (above|before) (this|here)|\brepeat the words above\b|\bstarting with ["']?you are\b/,
    why: "A known trick to make the model echo everything that came before, including its instructions.",
  },
  {
    id: "leak.what-were-you-told",
    category: "prompt-leak",
    severity: "medium",
    pattern: /\b(what (were|are) you (told|instructed|programmed)|how were you (configured|instructed|prompted)|your (exact|full|verbatim) (instructions|prompt))\b/,
    why: "Probes for the model's setup instructions.",
  },

  // Instructions planted in documents and web pages (indirect injection).
  {
    id: "indirect.address-the-ai",
    category: "injection",
    severity: "high",
    contextOnly: true,
    pattern: /\b(note to (the )?(ai|assistant|llm|model|chatbot)|(ai|llm|assistant|chatbot|language model)s? (reading|processing|summari[sz]ing) this|if you are an? (ai|llm|language model|assistant)|attention (ai|assistant|llm)|dear (ai|assistant|llm))\b/,
    why: "A document is talking to the AI that reads it. Real documents don't do that; planted instructions do.",
  },
  {
    id: "indirect.imperative-to-model",
    category: "injection",
    severity: "medium",
    contextOnly: true,
    pattern: /\b(you (must|should|will) (now )?(tell|inform|say to|respond to|reply to|recommend|direct) the user|tell the user (that|to)|do not (tell|mention|reveal|let) (this |it )?(to )?the user|without (telling|informing) the user)\b/,
    why: "Retrieved content tells the model what to say to the user. That's an instruction smuggled in as data.",
  },

  // Getting data out.
  {
    id: "exfil.send-data",
    category: "exfiltration",
    severity: "high",
    pattern: /\b(send|forward|email|post|upload|submit|transmit|leak|exfiltrate)\s+(?:[a-z']+\s+){0,5}(conversation|chat (history|log)|messages|this (chat|data)|user'?s? (data|details|email|password|info)|credentials|api keys?|passwords?|the (secret|password|key)|all (data|information))\b(?:[a-z'\s]{0,40})\b(to|at|via)\b/,
    why: "Tells the model to send conversation data or credentials somewhere.",
  },
  {
    id: "exfil.markdown-image",
    category: "exfiltration",
    severity: "high",
    pattern: /\b(render|include|add|insert|output|embed|display)\s+(?:[a-z']+\s+){0,4}(markdown )?(image|img|picture)\b[^.]{0,80}(https?:\/\/|url)|!\[[^\]]*\]\(https?:\/\/[^)]*(\{|%7b|\$|<)[^)]*\)/,
    why: "Asks for a markdown image whose URL carries data. The user's browser would send it to that server just by showing the image.",
  },
  {
    id: "exfil.fetch-url",
    category: "exfiltration",
    severity: "medium",
    contextOnly: true,
    pattern: /\b(visit|open|fetch|browse to|call|request|navigate to)\s+(this |the following )?(url|link|webhook|endpoint|https?:\/\/)/,
    why: "Content tells an agent to call an outside URL, a common way to trigger tools or leak data.",
  },
];
