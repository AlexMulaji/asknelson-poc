// Client-side checks for the sign-up and reset forms. They exist to give
// instant feedback; the server repeats every one of them.

export const MIN_PASSWORD = 8

export const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())

export const isMobile = (value) => String(value || '').replace(/\D/g, '').length >= 10
