import React, { useRef } from "react";

interface Props {
  onSubmit: (text: string) => void;
  disabled?: boolean;
  isQueueing?: boolean;
}

export function ComposeBox({ onSubmit, disabled = false, isQueueing = false }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const text = ref.current?.value.trim() ?? "";
    if (!text || disabled) return;
    onSubmit(text);
    if (ref.current) ref.current.value = "";
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="cwa-compose">
      <textarea
        ref={ref}
        className="cwa-compose__textarea"
        placeholder={isQueueing ? "Agent is busy — message will be queued..." : "Type a message..."}
        rows={4}
        disabled={disabled}
        onKeyDown={onKeyDown}
      />
      <button className="cwa-compose__send" onClick={submit} disabled={disabled}>
        {isQueueing ? "Queue" : "Send"}
      </button>
    </div>
  );
}
