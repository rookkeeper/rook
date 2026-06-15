import { fireEvent, render, screen } from "@testing-library/react";
import { QueueDisplay } from "./QueueDisplay";

describe("QueueDisplay", () => {
  it("edits and saves queued message text", () => {
    const onEditStart = vi.fn();
    const onEditChange = vi.fn();
    const onEditCancel = vi.fn();
    const onEditSave = vi.fn();
    const onSendNow = vi.fn();
    const onDelete = vi.fn();

    const { rerender } = render(
      <QueueDisplay
        messages={[{ id: "q1", text: "old", draftText: "old", isEditing: false }]}
        onEditStart={onEditStart}
        onEditChange={onEditChange}
        onEditCancel={onEditCancel}
        onEditSave={onEditSave}
        onSendNow={onSendNow}
        onDelete={onDelete}
      />,
    );

    fireEvent.click(screen.getByText("Edit"));
    expect(onEditStart).toHaveBeenCalledWith("q1");

    rerender(
      <QueueDisplay
        messages={[{ id: "q1", text: "old", draftText: "new text", isEditing: true }]}
        onEditStart={onEditStart}
        onEditChange={onEditChange}
        onEditCancel={onEditCancel}
        onEditSave={onEditSave}
        onSendNow={onSendNow}
        onDelete={onDelete}
      />,
    );

    fireEvent.click(screen.getByText("Save"));
    expect(onEditSave).toHaveBeenCalledWith("q1");
  });

  it("lets the user send a queued message immediately", () => {
    const onSendNow = vi.fn();
    render(
      <QueueDisplay
        messages={[{ id: "q1", text: "old", draftText: "old", isEditing: false }]}
        onEditStart={vi.fn()}
        onEditChange={vi.fn()}
        onEditCancel={vi.fn()}
        onEditSave={vi.fn()}
        onSendNow={onSendNow}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("Send now"));
    expect(onSendNow).toHaveBeenCalledWith("q1");
  });
});
