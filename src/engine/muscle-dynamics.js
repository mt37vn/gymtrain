function computeEpley1RM(weight, reps) {
  if (reps <= 0 || weight <= 0) return 0;
  return weight * (1 + reps / 30);
}

module.exports = {
  computeEpley1RM
};
