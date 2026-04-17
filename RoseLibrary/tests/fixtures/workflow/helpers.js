/**
 * Format a user's full name
 */
export function formatName(first, last) {
    return `${first} ${last}`;
}

export class Validator {
    /**
     * Validate an email address
     */
    validateEmail(email) {
        return email.includes('@');
    }

    /**
     * Validate a phone number
     */
    validatePhone(phone) {
        return phone.length >= 10;
    }
}
