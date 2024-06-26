declare global {
  type FormAccountUpdateResult = {
    errorMessage?: string
    errorFields?: string[]
    fullName?: string
    gender?: string
    dateOfBirth?: string
    location?: string
    email?: string
  }
}

export {}