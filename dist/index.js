// src/plugin/index.ts
function claudeFeedback(_options = {}) {
  return {
    name: "vite-plugin-claude-feedback",
    apply: "serve"
  };
}
var index_default = claudeFeedback;
export {
  claudeFeedback,
  index_default as default
};
