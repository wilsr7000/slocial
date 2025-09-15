// Mock for marked library to avoid ESM issues in tests
const markedFunction = (text) => {
  // Simple mock that just returns the text
  // In real tests, you might want to make this more sophisticated
  return text;
};

markedFunction.setOptions = () => {};

module.exports = {
  marked: markedFunction
};
