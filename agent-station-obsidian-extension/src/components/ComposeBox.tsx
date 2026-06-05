import React, { useRef } from "react";

interface Props {
  onSubmit: (text: string) => void;
  disabled: boolean;
}

export function ComposeBox({ onSubmit, disabled }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const text = ref.current?.value.trim() ?? "";
    if (!text) return;
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
        placeholder="Type a message..."
        rows={4}
        disabled={disabled}
        onKeyDown={onKeyDown}
      />
      <button className="cwa-compose__send" onClick={submit} disabled={disabled}>
        Send
      </button>
    </div>
  );
}
