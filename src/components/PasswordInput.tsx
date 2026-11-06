"use client";

import { useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/form";
import { cx } from "@/components/ui";

/** Visibility changes only the presentation; native validation and form names stay intact. */
export function PasswordInput({className, ...props}: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [visible, setVisible] = useState(false);
  const fieldId = props.id ?? props.name;
  const label = props.name?.startsWith("confirm") ? "confirmation password" : "password";
  return (
    <div className="password-field">
      <Input {...props} id={fieldId} type={visible ? "text" : "password"} className={cx("password-control",className)}/>
      <button type="button" aria-label={`${visible ? "Hide" : "Show"} ${label}`}
        aria-controls={fieldId} aria-pressed={visible} onClick={() => setVisible(value => !value)}>
        {visible ? <EyeOff size={18}/> : <Eye size={18}/>}
      </button>
    </div>
  );
}
