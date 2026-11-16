# @finance/assets

Arquivos de marca compartilhados pelo desktop e pelo celular. Ficam num pacote só para que os
dois apps usem exatamente o mesmo ícone, sem cópias que divirjam com o tempo.

| Arquivo | Uso |
|---------|-----|
| `icons/finance-icon-1024.png` | Original; ícone legado do Android (`icon` do Expo), de onde o `prebuild` gera os mipmaps |
| `icons/sizes/NxN.png` | Tamanhos prontos de 16 a 512 px: tema de ícones do `.deb` (o electron-builder só reconhece a pasta com esse nome de arquivo) e, o de 256 px, ícone da janela do Electron |
| `icons/finance-icon.ico` | Instalador e executável do Windows (16 a 256 px) |
| `icons/finance-icon-adaptive-foreground.png` | Primeiro plano do ícone adaptativo do Android 8+ |
| `icons/finance-icon.svg` | PNG embutido num SVG; não é vetor e não é usado pelos apps |

## Ícone adaptativo do Android

O launcher recorta o ícone com a própria máscara (círculo, gota, quadrado) e só garante visível o
círculo central de 66 dp de uma tela de 108 dp. O primeiro plano é o original reduzido a 72% sobre
o fundo do próprio desenho (`#111919`, a mesma cor do `backgroundColor` no `app.config.ts`), para o
símbolo caber na zona segura e a borda do quadrado arredondado cair fora da área visível.

Ao trocar o ícone, gere de novo com o ImageMagick, a partir desta pasta:

```sh
convert -size 1024x1024 xc:'#111919' \( icons/finance-icon-1024.png -resize 737x737 \) \
    -gravity center -composite -alpha off -depth 8 -strip icons/finance-icon-adaptive-foreground.png
```
