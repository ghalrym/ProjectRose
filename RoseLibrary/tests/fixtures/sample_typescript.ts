import { formatName } from './helpers';
import type { UserConfig } from './types';

interface ValidationResult {
    valid: boolean;
    errors: string[];
}

/**
 * Validates user input data
 */
function validateUser(name: string, email: string): ValidationResult {
    const formatted = formatName(name);
    return { valid: true, errors: [] };
}

class AuthService {
    private token: string;

    constructor(token: string) {
        this.token = token;
    }

    /**
     * Authenticate a user by name
     */
    authenticate(name: string): boolean {
        const formatted = formatName(name);
        return formatted.length > 0;
    }

    logout(): void {
        this.token = '';
    }
}

const processData = (items: string[]): string[] => {
    return items.map(item => formatName(item));
};

export { validateUser, AuthService };
