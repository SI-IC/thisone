import { memo } from "preact/compat";

const MemoBadge = memo(function MemoBadge({ label }: { label: string }) {
  return <span className="badge">{label}</span>;
});

export default MemoBadge;
