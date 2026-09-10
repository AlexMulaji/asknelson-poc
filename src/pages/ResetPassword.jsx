import { React, useState } from 'react'
import { 
  Logo, 
  Hgroup, 
  Field, 
  Btn,
  HelpFoot
} from '../components/auth/authPrims.jsx'


import '../assets/auth/auth_style.css'

export default function ResetPassword(){
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  return (
    <main className="screen screen--reset">
    <div className="screen__inner">
      <Logo />

      <Hgroup
        title="Reset Password"
        sub="Enter your new password below."
      />

      <div className="body-block body-block--reset">
        <div className="fields">
          <Field
            id="rp-pw"
            label="Password"
            hint="Enter your password"
            type="password"
            password
            autoComplete="new-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setError(null)
            }}
          />

          <Field
            id="rp-pw2"
            label="Password Confirmation"
            hint="Confirm password"
            type="password"
            password
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value)
              setError(null)
            }}
          />
        </div>

        <div
          className="stack"
          style={{ gap: "21px" }}
        >
          <Btn
            label="Reset Password"
            go="login"
          />

          <HelpFoot />
        </div>
      </div>
    </div>
    </main>
  );
};

