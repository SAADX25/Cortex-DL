import React from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import '../App.css'

interface ConfirmModalProps {
  isOpen: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  type?: 'danger' | 'warning' | 'info'
  dir?: 'rtl' | 'ltr'
  onConfirm: () => void
  onCancel: () => void
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  type = 'danger',
  dir = 'ltr',
  onConfirm,
  onCancel,
}) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="modal-overlay"
          dir={dir}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-modal-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
        >
          <motion.div
            className="modal-container"
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="modal-header">
              <div className="modal-title-group">
                <div className={`modal-icon ${type}`}>
                  <AlertTriangle size={24} />
                </div>
                <h3 className="modal-title" id="confirm-modal-title">{title}</h3>
              </div>
              <button
                className="modal-close-btn"
                onClick={onCancel}
                aria-label="Close dialog"
              >
                <X size={20} />
              </button>
            </div>

            <div className="modal-body">
              <p>{message}</p>
            </div>

            <div className="modal-footer">
              <button className="btn-icon-text ghost" onClick={onCancel}>
                {cancelText}
              </button>
              <button
                className={`btn-icon-text ${type === 'danger' ? 'danger' : 'primary'}`}
                onClick={onConfirm}
              >
                {confirmText}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default ConfirmModal
