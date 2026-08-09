import { createRoot } from "react-dom/client";

function App() {
  return (
    <div>
      <button id="target-button">Click target</button>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
