const EMOJI = /\p{Extended_Pictographic}/u;
const FILLER = /\b(please|simply|successfully|seamlessly|effortlessly|your adventure awaits)\b/i;
const UNCLEAR = /\bN\/A\b|\b12:00\s?(am|pm)\b/i;
const HEADING_OR_BUTTON = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "button", "Button"]);
const COPY_PROPS = new Set(["title", "aria-label", "placeholder", "alt", "label", "description", "message"]);

function isUpperStart(word) {
  const first = word[0];
  return first !== undefined && first !== first.toLowerCase() && first === first.toUpperCase();
}

function stripProperNouns(text, properNouns) {
  return properNouns.reduce((out, noun) => out.split(noun).join(" "), text);
}

function isTitleCase(text, properNouns) {
  const words = stripProperNouns(text, properNouns)
    .split(/\s+/)
    .filter((w) => /\p{L}/u.test(w));
  if (words.length < 2) return false;
  return words.slice(1).every((w) => isUpperStart(w) && w !== w.toUpperCase());
}

function isShouting(text, properNouns) {
  const letters = stripProperNouns(text, properNouns).replace(/[^\p{L}]/gu, "");
  return letters.length >= 4 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
}

const copy = {
  meta: {
    type: "problem",
    docs: { description: "User visible text follows docs/DESIGN.md copy rules: no emoji, no filler words, sentence case for headings and buttons." },
    messages: {
      emoji: "No emoji in the interface. Say it in words, or use a real icon component if the meaning needs a picture. See docs/DESIGN.md, Copy.",
      filler:
        'Do not use filler like "please", "simply", "successfully" or slogans. State what happened or what to do in plain words, for example "Saved" or "Add a flight". See docs/DESIGN.md, Copy.',
      unclear: 'Say "noon" or "midnight" instead of 12:00pm or 12:00am, and leave a missing value out instead of writing "N/A". See docs/DESIGN.md, Copy.',
      exclamation: "No exclamation marks. Write a calm, plain sentence ending in a full stop or nothing. See docs/DESIGN.md, Copy.",
      titleCase: 'Headings and buttons use sentence case: capitalise the first word and proper nouns only, for example "Add flight" not "Add Flight". See docs/DESIGN.md, Copy.',
      shouting: "Do not write headings or buttons in capitals. Use sentence case and let size and weight carry emphasis. See docs/DESIGN.md, Copy.",
    },
    schema: [{ type: "object", properties: { properNouns: { type: "array", items: { type: "string" } } }, additionalProperties: false }],
  },
  create(context) {
    const properNouns = context.options[0]?.properNouns ?? [];

    function checkText(node, text, strictCase) {
      const trimmed = text.replace(/\s+/g, " ").trim();
      if (trimmed === "") return;
      if (EMOJI.test(trimmed)) context.report({ node, messageId: "emoji" });
      if (FILLER.test(trimmed)) context.report({ node, messageId: "filler" });
      if (UNCLEAR.test(trimmed)) context.report({ node, messageId: "unclear" });
      if (trimmed.includes("!")) context.report({ node, messageId: "exclamation" });
      if (!strictCase) return;
      if (isShouting(trimmed, properNouns)) context.report({ node, messageId: "shouting" });
      else if (isTitleCase(trimmed, properNouns)) context.report({ node, messageId: "titleCase" });
    }

    function enclosingName(node) {
      let current = node.parent;
      while (current && current.type !== "JSXElement") current = current.parent;
      const name = current?.openingElement.name;
      return name && name.type === "JSXIdentifier" ? name.name : null;
    }

    function containerOf(node) {
      let child = node;
      let current = node.parent;
      while (current) {
        if (current.type === "JSXExpressionContainer") return current;
        const passesThrough =
          current.type === "TemplateLiteral" ||
          current.type === "LogicalExpression" ||
          (current.type === "ConditionalExpression" && current.test !== child);
        if (!passesThrough) return null;
        child = current;
        current = current.parent;
      }
      return null;
    }

    function checkExpressionText(node, text, strictCase) {
      const container = containerOf(node);
      if (!container) return;
      const owner = container.parent;
      if (owner.type === "JSXAttribute") {
        if (owner.name.type === "JSXIdentifier" && COPY_PROPS.has(owner.name.name)) checkText(node, text, false);
        return;
      }
      checkText(node, text, strictCase && HEADING_OR_BUTTON.has(enclosingName(node)));
    }

    return {
      JSXText(node) {
        checkText(node, node.value, HEADING_OR_BUTTON.has(enclosingName(node)));
      },
      Literal(node) {
        if (typeof node.value === "string") checkExpressionText(node, node.value, true);
      },
      TemplateElement(node) {
        checkExpressionText(node, node.value.cooked ?? "", false);
      },
      JSXAttribute(node) {
        if (node.name.type !== "JSXIdentifier" || !COPY_PROPS.has(node.name.name)) return;
        const value = node.value;
        if (value?.type === "Literal" && typeof value.value === "string") checkText(value, value.value, false);
      },
    };
  },
};

const plugin = { rules: { copy } };

export default plugin;
