import Modal, { modalBtn } from './Modal.jsx'

// A yes/cancel prompt for actions that throw progress away (e.g. Restart
// Journey). Confirm runs `onConfirm` and closes; Cancel, Escape or a tap on
// the backdrop just closes.
export default function ConfirmDialog({ open, title, body, confirmLabel, onConfirm, onClose }) {
  return (
    <Modal open={open} onClose={onClose} labelledBy="confirm-title">
      <h2 id="confirm-title" className="font-display text-[26px] font-extrabold leading-tight text-ink">
        {title}
      </h2>
      <p className="mx-auto mt-2.5 max-w-[320px] text-[14px] font-light leading-relaxed text-ink-soft lg:text-[16px]">
        {body}
      </p>
      <div className="mt-7 space-y-3">
        <button
          type="button"
          data-autofocus
          onClick={() => {
            onClose()
            onConfirm()
          }}
          className={`${modalBtn.base} ${modalBtn.brand}`}
        >
          {confirmLabel}
        </button>
        <button type="button" onClick={onClose} className={`${modalBtn.base} ${modalBtn.outline}`}>
          Cancel
        </button>
      </div>
    </Modal>
  )
}
