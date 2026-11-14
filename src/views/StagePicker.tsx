import { useId } from "react";

export function StagePicker({
  stages,
  value,
  onChange,
}: {
  stages: ReadonlyArray<{ id: string; title: string }>;
  value: string;
  onChange: (id: string) => void;
}) {
  const id = useId();

  return (
    <div className="stage-navigation">
      <label className="stage-label" htmlFor={id}>
        阶段详情
      </label>
      <select
        id={id}
        aria-label="选择阶段详情"
        value={stages.some((stage) => stage.id === value) ? value : ""}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="" disabled>
          选择阶段
        </option>
        {stages.map((stage) => (
          <option key={stage.id} value={stage.id}>
            {stage.title}
          </option>
        ))}
      </select>
    </div>
  );
}
