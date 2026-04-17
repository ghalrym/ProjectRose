import { formatName, Validator } from './helpers';

const validator = new Validator();

function processUser(userData) {
    const fullName = formatName(userData.first, userData.last);
    const { validateEmail } = validator;
    const isValid = validator.validateEmail(userData.email);
    return { fullName, isValid };
}

export default processUser;
