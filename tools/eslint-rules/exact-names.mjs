const isString = (node) => Boolean(node) && ((node.type === "Literal" && typeof node.value === "string") || node.type === "TemplateLiteral");

const isObject = (node) => Boolean(node) && node.type === "ObjectExpression";

const keyName = (property) => {
  if (property.type !== "Property" || property.computed) return undefined;
  if (property.key.type === "Identifier") return property.key.name;
  if (property.key.type === "Literal" && typeof property.key.value === "string") return property.key.value;
  return undefined;
};

const propertyNamed = (objectNode, name) => (isObject(objectNode) ? objectNode.properties.find((property) => keyName(property) === name) : undefined);

const hasSpread = (objectNode) => isObject(objectNode) && objectNode.properties.some((property) => property.type === "SpreadElement");

const hasExactTrue = (objectNode) => {
  const exact = propertyNamed(objectNode, "exact");
  return Boolean(exact) && exact.value.type === "Literal" && exact.value.value === true;
};

export const exactNames = {
  meta: {
    type: "problem",
    fixable: "code",
    docs: { description: "A Playwright locator that matches a string name or label must say exact: true." },
    messages: {
      exact:
        "Add exact: true. Without it a string name is a case insensitive substring match, so the locator also matches longer labels and breaks when another button or field gains a similar name. Use a regular expression only when a pattern is what you mean. See docs/ENGINEERING.md, rule 10.",
    },
    schema: [],
  },
  create(context) {
    const withExact = (options) => (fixer) => {
      if (!isObject(options) || propertyNamed(options, "exact")) return null;
      const last = options.properties[options.properties.length - 1];
      return fixer.insertTextAfter(last, ", exact: true");
    };
    const unprovable = (options) => Boolean(options) && (!isObject(options) || hasSpread(options));
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression" || callee.computed || callee.property.type !== "Identifier") return;
        if (callee.property.name === "getByRole") {
          const options = node.arguments[1];
          if (unprovable(options)) {
            context.report({ node, messageId: "exact" });
            return;
          }
          const name = propertyNamed(options, "name");
          if (name && isString(name.value) && !hasExactTrue(options)) context.report({ node, messageId: "exact", fix: withExact(options) });
        }
        if (callee.property.name === "getByLabel") {
          const [label, options] = node.arguments;
          if (!isString(label)) return;
          if (unprovable(options)) {
            context.report({ node, messageId: "exact" });
            return;
          }
          if (hasExactTrue(options)) return;
          context.report({ node, messageId: "exact", fix: options ? withExact(options) : (fixer) => fixer.insertTextAfter(label, ", { exact: true }") });
        }
      },
    };
  },
};
