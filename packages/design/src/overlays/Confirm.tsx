import type { ComponentChildren } from "preact";
import { Button } from "../actions/Button";
import { Dialog } from "./Dialog";

/** A yes/no dialog before an action that cannot be undone. */
export interface ConfirmProps {
  title: ComponentChildren;
  message?: ComponentChildren;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
  fixed?: boolean;
}

export function Confirm({ title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", danger, onConfirm, onCancel, fixed }: ConfirmProps) {
  return (
    <Dialog title={title} fixed={fixed} onClose={onCancel} role="alertdialog"
      footer={<><Button onClick={onCancel}>{cancelLabel}</Button><Button variant={danger ? "danger" : "primary"} icon={danger ? "trash" : undefined} autoFocus onClick={onConfirm}>{confirmLabel}</Button></>}>
      {message}
    </Dialog>
  );
}
