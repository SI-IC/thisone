// Minimal app entry for the Phase 4 overlay smoke. No framework — the full
// Vue + Pinia demo lands in Phase 7. Logs a line so a captured console buffer
// has content.
console.log("demo app booted");
document.getElementById("hello")?.addEventListener("click", () => {
  console.log("hello clicked");
});
