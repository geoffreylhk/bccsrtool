const checkbox = document.getElementById('agree');
const beginBtn = document.getElementById('beginBtn');

checkbox.addEventListener('change', function() {
  beginBtn.disabled = !checkbox.checked;
});