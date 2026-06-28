import { FormEvent, useEffect, useState } from "react";

export type AppDialogState =
  | {
      type: "text";
      title: string;
      label: string;
      value: string;
      placeholder?: string;
      confirmText: string;
      resolve: (value: string | null) => void;
    }
  | {
      type: "confirm";
      title: string;
      message: string;
      confirmText: string;
      destructive?: boolean;
      resolve: (value: boolean) => void;
    };

interface AppDialogProps {
  dialog: AppDialogState | null;
  onClose: () => void;
}

export function AppDialog({ dialog, onClose }: AppDialogProps) {
  const [value, setValue] = useState("");

  useEffect(() => {
    setValue(dialog?.type === "text" ? dialog.value : "");
  }, [dialog]);

  useEffect(() => {
    if (!dialog) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (dialog.type === "text") {
          dialog.resolve(null);
        } else {
          dialog.resolve(false);
        }
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dialog, onClose]);

  if (!dialog) return null;

  const cancel = () => {
    if (dialog.type === "text") {
      dialog.resolve(null);
    } else {
      dialog.resolve(false);
    }
    onClose();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (dialog.type === "text") {
      dialog.resolve(value);
    } else {
      dialog.resolve(true);
    }
    onClose();
  };

  return (
    <div
      className="no-drag fixed inset-0 z-[100] flex items-center justify-center bg-black/25 px-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) cancel();
      }}
    >
      <form
        onSubmit={submit}
        className="w-full max-w-[420px] rounded-lg border border-[color:var(--border)] bg-[color:var(--panel)] p-4 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="text-base font-semibold text-[color:var(--text)]">{dialog.title}</div>

        {dialog.type === "text" ? (
          <label className="mt-4 block text-xs text-[color:var(--muted)]">
            {dialog.label}
            <input
              autoFocus
              value={value}
              placeholder={dialog.placeholder}
              onChange={(event) => setValue(event.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--app-bg)] px-3 text-sm text-[color:var(--text)] outline-none focus:border-[color:var(--accent)]"
            />
          </label>
        ) : (
          <div className="mt-3 text-sm leading-relaxed text-[color:var(--muted)]">
            {dialog.message}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={cancel}
            className="rounded-md border border-[color:var(--border)] px-3 py-2 text-sm hover:bg-[color:var(--selected)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            className={`rounded-md px-3 py-2 text-sm font-medium ${
              dialog.type === "confirm" && dialog.destructive
                ? "bg-red-600 text-white"
                : "bg-[color:var(--button)] text-[color:var(--button-text)]"
            }`}
          >
            {dialog.confirmText}
          </button>
        </div>
      </form>
    </div>
  );
}
