document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('download-form');
    const urlInput = document.getElementById('url-input');
    const submitBtn = document.getElementById('download-btn');
    const btnText = document.querySelector('.btn-text');
    const spinner = document.getElementById('loading-spinner');
    const statusBox = document.getElementById('status-message');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const url = urlInput.value.trim();
        if (!url) return;

        // UI State: Loading
        submitBtn.disabled = true;
        btnText.classList.add('hidden');
        spinner.classList.remove('hidden');
        statusBox.classList.add('hidden');
        statusBox.className = 'status-box'; // reset classes

        try {
            const response = await fetch('/api/download', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ url })
            });

            const data = await response.json();

            // UI State: Result
            statusBox.classList.remove('hidden');
            
            if (data.success) {
                statusBox.classList.add('status-success');
                statusBox.innerHTML = `<strong>Thành công!</strong><br/>${data.message}`;
                urlInput.value = ''; // clear input on success
            } else {
                statusBox.classList.add('status-error');
                statusBox.innerHTML = `<strong>Thất bại!</strong><br/>${data.message}`;
            }

        } catch (error) {
            statusBox.classList.remove('hidden');
            statusBox.classList.add('status-error');
            statusBox.innerHTML = `<strong>Lỗi kết nối!</strong><br/>Không thể liên lạc với máy chủ.`;
        } finally {
            // UI State: Reset Button
            submitBtn.disabled = false;
            btnText.classList.remove('hidden');
            spinner.classList.add('hidden');
        }
    });
});
