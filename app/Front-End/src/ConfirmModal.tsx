import React from 'react'
import { AlertTriangle, X } from 'lucide-react'
import './App.css'

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
  if (!isOpen) return null

  return (
    <div className="modal-overlay" dir={dir}>
      <div className="modal-container fade-in">
        <div className="modal-header">
          <div className="modal-title-group">
            <div className={`modal-icon ${type}`}>
              <AlertTriangle size={24} />
            </div>
            <h3 className="modal-title">{title}</h3>
          </div>
          <button className="modal-close-btn" onClick={onCancel}>
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
      </div>
    </div>
  )
}

export default ConfirmModal
