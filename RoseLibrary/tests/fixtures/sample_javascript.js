import { formatName, validateEmail as validate } from './helpers';
import Utils from './utils';

/**
 * Processes user input data
 */
function processInput(data) {
    const name = formatName(data.name);
    return validate(data.email);
}

class UserService {
    /**
     * Creates a new user
     */
    create(userData) {
        return processInput(userData);
    }

    delete(userId) {
        return Utils.remove(userId);
    }
}

const fetchData = (url) => {
    return Utils.get(url);
};

export { fetchData };
