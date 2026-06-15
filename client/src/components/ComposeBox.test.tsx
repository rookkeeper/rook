import { fireEvent, render, screen } from "@testing-library/react";
import { ComposeBox } from "./ComposeBox";

describe("ComposeBox", () => {
  it("submits on Enter without Shift", () => {
    const onSubmit = vi.fn();
    render(<ComposeBox isAgentProcessing={false} onSubmit={onSubmit} />);
    const input = screen.getByPlaceholderText("Message your agent");
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false, nativeEvent: { key: "Enter", shiftKey: false } });
    expect(onSubmit).toHaveBeenCalledWith("hello");
  });
});
