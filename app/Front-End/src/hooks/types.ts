/**
 *  Shared types for controller hooks.
 *
 *  Extracted here to avoid circular imports between the composition shell
 *  (useAppController) and the domain hooks that receive the modal setter.
 */

export type ModalConfig = {
  isOpen: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  onConfirm: () => void
  type?: 'danger' | 'warning' | 'info'
}
