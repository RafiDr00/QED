/**
 * eslint-plugin-qed
 *
 * One rule: no raw design values outside packages/tokens. Colours, sizes,
 * radii and spacing come from generated custom properties, never from a
 * literal typed into a component.
 *
 * verify.ts gate G2 runs the same check over CSS, which ESLint does not parse.
 */

const HEX = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;
const COLOR_FN = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\s*\(/;
const LENGTH = /(?<![\w-])\d*\.?\d+(px|rem|em|pt|vh|vw|ch)(?![\w-])/;
const NAMED = /\b(?:red|green|blue|black|white|grey|gray|orange|yellow|purple|silver|teal|navy)\b/i;

/** CSS properties that must take a token, written as a style object key. */
const STYLE_PROPS = new Set([
  "color",
  "background",
  "backgroundColor",
  "borderColor",
  "fill",
  "stroke",
  "padding",
  "margin",
  "gap",
  "fontSize",
  "lineHeight",
  "borderRadius",
  "width",
  "height",
]);

/** Values a token itself may carry through, or that carry no design meaning. */
function isAllowed(value) {
  // var() references and the keywords that mean "no value".
  return (
    /^var\(--[a-z0-9-]+\)$/.test(value.trim()) ||
    ["", "0", "none", "auto", "inherit", "currentColor", "transparent"].includes(
      value.trim(),
    )
  );
}

function check(context, node, raw) {
  if (typeof raw !== "string" || isAllowed(raw)) return;
  if (HEX.test(raw)) {
    context.report({ node, messageId: "hex", data: { value: raw.trim() } });
    return;
  }
  if (COLOR_FN.test(raw)) {
    context.report({ node, messageId: "colorFn", data: { value: raw.trim() } });
    return;
  }
  const length = LENGTH.exec(raw);
  if (length) {
    context.report({
      node,
      messageId: "length",
      data: { value: length[0], unit: length[1] },
    });
    return;
  }
  if (NAMED.test(raw) && /color|fill|stroke|background/i.test(raw)) {
    context.report({ node, messageId: "named", data: { value: raw.trim() } });
  }
}

const noRawDesignValues = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Design values come from @qed/tokens. No hex, rgb(), px or rem literals outside packages/tokens.",
    },
    schema: [],
    messages: {
      hex: "Hard-coded colour '{{value}}'. Use a token from @qed/tokens (var(--…)).",
      colorFn:
        "Hard-coded colour function in '{{value}}'. Use a token from @qed/tokens.",
      length:
        "Hard-coded size '{{value}}'. Use a spacing, radius, border or type token from @qed/tokens.",
      named:
        "Named colour in '{{value}}'. The system owns one colour; use a token from @qed/tokens.",
    },
  },
  create(context) {
    return {
      Literal(node) {
        if (typeof node.value !== "string") return;
        check(context, node, node.value);
      },
      TemplateElement(node) {
        check(context, node, node.value.cooked ?? node.value.raw);
      },
      // style={{ padding: 16 }} - a bare number is a px literal in React.
      Property(node) {
        const key =
          node.key.type === "Identifier"
            ? node.key.name
            : node.key.type === "Literal"
              ? String(node.key.value)
              : undefined;
        if (key === undefined || !STYLE_PROPS.has(key)) return;
        if (
          node.value.type === "Literal" &&
          typeof node.value.value === "number" &&
          node.value.value !== 0
        ) {
          context.report({
            node: node.value,
            messageId: "length",
            data: { value: `${node.value.value}`, unit: "px" },
          });
        }
      },
    };
  },
};

export default {
  meta: { name: "eslint-plugin-qed", version: "0.0.0" },
  rules: { "no-raw-design-values": noRawDesignValues },
};
