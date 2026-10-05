export type ModalConfig = {
  isOpen: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  onConfirm: () => void
  onCancel?: () => void
  type?: 'danger' | 'warning' | 'info'
}
