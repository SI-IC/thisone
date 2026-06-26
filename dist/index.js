// src/plugin/index.ts
function claudeFeedback(_options = {}) {
  return {
    name: "vite-plugin-claude-feedback",
    apply: "serve"
  };
}
export {
  claudeFeedback as default
};
