document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.content img').forEach(function (img) {
        img.addEventListener('click', function () {
            const rect = img.getBoundingClientRect();

            const overlay = document.createElement('div');
            overlay.className = 'img-overlay';

            const popup = document.createElement('img');
            popup.src = img.src;
            popup.alt = img.alt;
            popup.className = 'img-popup';
            popup.style.width = (rect.width * 3) + 'px';

            overlay.appendChild(popup);
            document.body.appendChild(overlay);

            requestAnimationFrame(function () {
                overlay.classList.add('visible');
            });

            function close() {
                overlay.classList.remove('visible');
                overlay.addEventListener('transitionend', function () {
                    overlay.remove();
                }, { once: true });
            }

            overlay.addEventListener('click', function (e) {
                if (e.target === overlay) close();
            });

            document.addEventListener('keydown', function handler(e) {
                if (e.key === 'Escape') {
                    close();
                    document.removeEventListener('keydown', handler);
                }
            });
        });
    });
});
