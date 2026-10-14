export default {home: async filter => JSON.stringify({filter, promise:true}), search: key => Promise.reject(new Error(key))};
