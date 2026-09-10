import { React, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { 
  Logo, 
  BackBtn,
  Hgroup, 
  Option, 
  Btn,
  Alert,
  Field, 
  Resend,
  HelpFoot
} from '../components/auth/authPrims.jsx'


import '../assets/auth/auth_style.css'

export default function ForgotOptions() {
     //Need to clean this up on next commit

  const ICON = {
  chevron:<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M10 17L15 12L10 7" stroke="#637885" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>,
  hidden:<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M10.73 5.073C11.1516 5.024 11.5756 5 12 5c4.664 0 8.4 2.903 10 7-.387.997-.911 1.935-1.555 2.788M6.52 6.519C4.48 7.764 2.9 9.693 2 12c1.6 4.097 5.336 7 10 7 1.932.01 3.829-.516 5.48-1.52M9.88 9.88a3 3 0 104.24 4.24M4 4l16 16" stroke="#637885" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>,
  eye:<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14.1213 14.1213A3 3 0 109.8787 9.8787a3 3 0 004.2426 4.2426Z" stroke="#637885" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 12c1.6-4.097 5.336-7 10-7s8.4 2.903 10 7c-1.6 4.097-5.336 7-10 7s-8.4-2.903-10-7Z" stroke="#637885" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>,
  tick:<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4.125 13.125L9.375 18.375L19.875 7.125" stroke="#637885" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"/></svg>,
  call:<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15.5 21a1.5 1.5 0 001.5-1.5v-3.2a1.5 1.5 0 00-1.18-1.47l-2.3-.5a1.5 1.5 0 00-1.46.5l-.9 1.06a13.6 13.6 0 01-4.05-4.05l1.06-.9a1.5 1.5 0 00.5-1.46l-.5-2.3A1.5 1.5 0 007.7 5H4.5A1.5 1.5 0 003 6.5C3 14.5 8.5 21 15.5 21Z" stroke="#637885" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>,
  email:<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 5h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7a2 2 0 012-2Z" stroke="#637885" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.5 7.2l8.42 5.62a2 2 0 002.16 0L21.5 7.2" stroke="#637885" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>,
  info:<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 11v5M12 21a9 9 0 110-18 9 9 0 010 18ZM12.05 8v.1h-.1V8h.1Z" stroke="#637885" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>,
  restart:<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4.252 4v5H9M5.07 8a8 8 0 1114.855 5.081A8 8 0 014.252 14" stroke="#637885" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>,
  loader:<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 21.25a9.25 9.25 0 100-18.5A9.25 9.25 0 002.75 12" stroke="#637885" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
};

const COPY = {
  cell: {
    sub: "Enter your mobile number and we will send you a link to reset your password.",
    field: {
      id: "fp-mobile",
      label: "Mobile Number",
      hint: "e.g. 012 345 6789",
      type: "tel",
      inputMode: "tel",
    },
    filled: "012 345 6789",
    failTitle: "Account not found",
    failText:
      "There’s no account associated with the number you have provided. Please check details and try again.",
    okTitle: "Check your messages",
    okText:
      "We have sent you a link to reset your password. Please check your messages.",
    back: "forgotOptionsCell",
  },

  email: {
    sub: "Enter your email address and we will send you a link to reset your password.",
    field: {
      id: "fp-email",
      label: "Email Address",
      hint: "name@example.com",
      type: "email",
    },
    filled: "jane.doe@example.com",
    failTitle: "Account not found",
    failText:
      "There’s no account associated with the email you have provided. Please check your details and try again.",
    okTitle: "Check your email",
    okText:
      "We have sent you a link to reset your password. Please check your inbox and spam folder.",
    back: "forgotOptionsEmail",
  },
};

    const [method, setMethod] = useState("cell"); // "cell" | "email"
    const [state, setState] = useState("idle");   // "idle" | "fail" | "success"
    const [step, setStep] = useState(1); // 1: choose method, 2: enter details,
    const [contact, setContact] = useState(""); // user input for email or phone number
    const navigate = useNavigate()

    switch (step) {
      case 1:
        return (
            <main className="screen screen--forgot">
    <div className="screen__inner">
      <BackBtn 
      go="login"
      onClick={() => navigate('/login')} 
      />

      <Logo />

      <Hgroup
        title="Forgot Password"
        sub="Choose how you would like to receive your password reset link."
        centered
      />

      <div className="body-block">
        <div
          className="options"
          role="radiogroup"
          aria-label="Reset link delivery method"
        >
          <Option
            id="cell"
            icon={ICON.call}
            title="Cellphone"
            desc="Send a reset link to your mobile number"
            selected={method === "cell"}
            onSelect={() => setMethod("cell")}
          />

          <Option
            id="email"
            icon={ICON.email}
            title="Email"
            desc="Send a reset link to your email address"
            selected={method === "email"}
            onSelect={() => setMethod("email")}
          />
        </div>

        <Btn
          label="Continue"
          act="continue"
          onClick={() => setStep(2)}
        />
      </div>
    </div>
    </main>
  );

      case 2:
        const c = COPY[method];
        return (
          <main className="screen screen--forgot">
    <div className="screen__inner">
      <BackBtn onClick = {() => {
        setStep(1);
        setState("idle");
      }} />

      <Logo />

      <Hgroup
        title="Forgot Password"
        sub={c.sub}
        centered
      />

      <div className="body-block">
        <div className="stack">
          <div className="fields">
            <Field
              {...c.field}
              value={contact}
              onChange={(e) => {
              setContact(e.target.value)
              setError(null)
              }}
            />
          </div>

          {state === "success" && <Resend />}
        </div>

        {state === "fail" && (
          <Alert
            type="error"
            title={c.failTitle}
            text={c.failText}
          />
        )}

        {state === "success" && (
          <Alert
            type="success"
            title={c.okTitle}
            text={c.okText}
          />
        )}

        <div
          className="stack"
          style={{ gap: "21px" }}
        >
          {state === "success" ? (
            <Btn
              label="Finish"
              go="resetPassword"
            />
          ) : (
            <Btn
              label="Send Reset Link"
              act={`send:${method}`}
              onClick = {() => setState("fail")}
            />
          )}

          <HelpFoot />
        </div>
      </div>
    </div>
    </main>
        );

      default:
        return null;
    }


  function ForgotEntry ({ method, state, setContact }) {
  const c = COPY[method];
  const filled = state !== "idle";

};

};





