export default [
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        window: "readonly",
        document: "readonly",
        process: "readonly",
        require: "readonly",
        module: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        localStorage: "readonly",
        confirm: "readonly",
        fetch: "readonly",
        Object: "readonly",
        Array: "readonly",
        Number: "readonly",
        String: "readonly",
        Math: "readonly",
        Date: "readonly",
        Set: "readonly",
        Error: "readonly",
        JSON: "readonly"
      }
    },
    rules: {
      "eqeqeq": "error",
      "semi": ["error", "always"]
    }
  }
];
