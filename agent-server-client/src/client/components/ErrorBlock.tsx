import { Block, ErrorBlock as ErrorBlockType } from "../types";
import { createBlockClickHandler } from "../useBlockClick";

interface Props {
  block: ErrorBlockType;
  onOpenBlock?: (block: Block) => void;
}

export function ErrorBlock({ block, onOpenBlock }: Props) {
  const openBlock = createBlockClickHandler(block, onOpenBlock);

  return (
    <div className="cwa-error-block" onClick={openBlock} title="Click to expand">
      <div className="cwa-error-block__label">{block.source} error</div>
      <div className="cwa-error-block__message">{block.message}</div>
    </div>
  );
}
