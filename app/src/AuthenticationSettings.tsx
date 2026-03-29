import React, { useState } from 'react';
import { translations, Language } from './translations';

interface AuthenticationSettingsProps {
  lang: Language;
  cookieFile: string | null;
  setCookieFile: (path: string | null) => void;
  cookieBrowser: string;
  setCookieBrowser: (browser: string) => void;
  username: string;
  setUsername: (val: string) => void;
  password: string;
  setPassword: (val: string) => void;
}

const AuthenticationSettings: React.FC<AuthenticationSettingsProps> = ({
  lang,
  cookieFile,
  setCookieFile,
  cookieBrowser,
  setCookieBrowser,
  username,
  setUsername,
  password,
  setPassword,
}) => {
  const t = translations[lang];
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const onSelectCookiesFile = async () => {
    try {
      const path = await window.cortexDl.selectCookiesFile();
      if (path) setCookieFile(path);
    } catch (err) {
      console.error('Failed to select cookies file:', err);
    }
  };

  return (
    <div className="settings-group">
      <h3>{t.auth_group}</h3>
      
      {/* Cookies Section */}
      <div className="auth-section">
        <div className="auth-section-header">
          <h4>{t.cookies_section_title}</h4>
          <p className="muted">{t.cookies_section_desc}</p>
        </div>

        <div className="setting-row vertical">
          <label className="setting-title">{t.select_cookies_file}</label>
          <div className="file-input-group">
            <input 
              type="text" 
              readOnly 
              value={cookieFile || ''} 
              className="main-input small"
              placeholder="cookies.txt..."
            />
            <button className="btn-icon-text ghost" onClick={onSelectCookiesFile}>
              {t.choose_folder.split('...')[0]}
            </button>
            {cookieFile && (
              <button className="btn-icon-text ghost danger" onClick={() => setCookieFile(null)}>
                ✕
              </button>
            )}
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-title">{t.browser_load_cookies}</div>
          </div>
          <div className="setting-control">
            <select 
              className="browser-select small" 
              value={cookieBrowser} 
              onChange={(e) => setCookieBrowser(e.target.value)}
            >
              <option value="none">{t.cookies_none}</option>
              <option value="chrome">Chrome</option>
              <option value="firefox">Firefox</option>
              <option value="edge">Edge</option>
              <option value="brave">Brave</option>
              <option value="opera">Opera</option>
            </select>
          </div>
        </div>
      </div>

      {/* Advanced Section */}
      <div className={`auth-section advanced ${showAdvanced ? 'open' : ''}`}>
        <div 
          className="auth-section-header clickable" 
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          <div className="flex-row">
            <h4>{t.advanced_auth_title}</h4>
            <span className="arrow">{showAdvanced ? '▼' : '▶'}</span>
          </div>
        </div>

        {showAdvanced && (
          <div className="advanced-content fade-in">
            <div className="setting-row vertical">
              <label className="setting-title">{t.basic_auth_label}</label>
              <div className="auth-inputs">
                <div className="input-with-label">
                  <span>{t.username_label}</span>
                  <input 
                    type="text" 
                    className="main-input small" 
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>
                <div className="input-with-label">
                  <span>{t.password_label}</span>
                  <div className="password-input-wrapper">
                    <input 
                      type={showPassword ? 'text' : 'password'} 
                      className="main-input small" 
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button 
                      className="show-pass-btn" 
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? t.hide_password : t.show_password}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AuthenticationSettings;
