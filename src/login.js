const core = require('@actions/core');
const puppeteer = require('puppeteer');

let timeout = function (delay) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(1)
      } catch (e) {
        reject(0)
      }
    }, delay);
  })
}
let page = null
let globalData = null
const debug = false
const bigImageSelector = '#captcha-verify-image';
const smallImageSelector = '.captcha_verify_img_slide';
const refreshBtnSelector = '.secsdk_captcha_refresh';
async function run(email, password) {
  const browser = await puppeteer.launch({
    // headless: false,
  });
  page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 })
  core.info('✅ start navigation to juejin')
  await page.goto('https://juejin.cn/');
  // 2.打开登录页面
  const loginBtn = await page.waitForSelector('.login-button')
  await loginBtn.click()
  const switchBtn = await page.waitForSelector('.auth-form .clickable')
  await switchBtn.click()
  await timeout(500);
  // 3.输入账号密码
  await page.type('input[name=loginPhoneOrEmail]', email)
  await timeout(500);
  await page.type('input[name=loginPassword]', password)
  // 4.点击验证
  await timeout(500);
  await page.click('.auth-form .btn')
  const haveLogin = await verifyCaptcha();
  if (haveLogin) {
    await addArticle('新文章', `
# 欢迎使用马克飞象

@(示例笔记本)[马克飞象|帮助|Markdown]

**马克飞象**是一款专为印象笔记（Evernote）打造的Markdown编辑器，通过精心的设计与技术实现，配合印象笔记强大的存储和同步功能，带来前所未有的书写体验。特点概述：

- **功能丰富** ：支持高亮代码块、*LaTeX* 公式、流程图，本地图片以及附件上传，甚至截图粘贴，工作学习好帮手；
- **得心应手** ：简洁高效的编辑器，提供[桌面客户端][1]以及[离线Chrome App][2]，支持移动端 Web；
- **深度整合** ：支持选择笔记本和添加标签，支持从印象笔记跳转编辑，轻松管理。
`)
  }

  await browser.close();
}

async function addArticle(title, content) {
  if (content.length < 50) {
    core.error('❌ article content length must > 50');
    return;
  }
  await page.goto('https://juejin.cn/editor/drafts/new?v=2');
  const titleElement = await page.waitForSelector('.title-input');
  await titleElement.type(title, { delay: 100 });
  core.info('✅ set title')

  await timeout(1000);
  const editor = await page.waitForSelector('.CodeMirror');
  await editor.evaluate((node, _content) => {
    node.CodeMirror.setValue(_content);
  }, content);
  core.info('✅ set content')

  await page.waitForSelector('.publish-popup > .xitu-btn')
  await page.click('.publish-popup > .xitu-btn')

  // frontend tag
  await page.waitForSelector('.category-list > .item')
  await page.evaluate(() => {
    const node = document.querySelector('.category-list > .item:nth-child(2)')
    node.click()
  }, content);
  core.info('✅ set category')

  await page.waitForSelector('.tag-input > .select-plus')
  await page.click('.tag-input > .select-plus')
  await page.waitForSelector('.tag-select-add-margin .byte-select-option')
  await page.click('.tag-select-add-margin .byte-select-option')
  core.info('✅ set tag')

  const summary = await page.waitForSelector('.publish-popup .byte-input__textarea')
  await summary.evaluate((node, _content) => {
    node.value = _content.replaceAll('\n', '').trim().slice(0, 80);
  }, content);
  await summary.type('...', { delay: 100 });
  core.info('✅ set summary')

  await page.waitForSelector('.footer > .btn-container > .primary')
  await page.click('.footer > .btn-container > .primary')
  core.info('✅ publishing')

  await timeout(3000);

  const isSuccess = await page.$('.thanks', { timeout: 5000 });
  if (isSuccess) {
    core.info('✅ publish success')
  } else {
    core.error('❌ publish failed')
  }
}

/**
* 截图并开始验证
*/
async function verifyCaptcha() {
  await timeout(1000);
  await snapshotAndGetData();
  return tryValidation();
}
/**
* 截图生成新图片用于转到 canvas，避免 canvas 跨域问题
*/
async function snapshotAndGetData() {
  const smallImage = await page.waitForSelector(smallImageSelector);
  core.info('✅ find small image')
  // 先隐藏覆盖在大图片上的小图片再截图
  await smallImage.evaluate(e => { e.style.display = "none" });

  const bigImage = await page.waitForSelector(bigImageSelector);
  core.info('✅ find big image')
  // 复制一个原图大小的图片，避免缩放引起像素点模糊影响判断
  await bigImage.evaluate((node) => {
    const tempImage = new Image;
    tempImage.id = 'originalSizeImage';
    tempImage.src = node.src;
    tempImage.style.zIndex = 999;
    tempImage.style.position = 'fixed';
    document.body.appendChild(tempImage);
  });
  core.info('✅ copy big image')

  await timeout(1000);
  const originalSizeImage = await page.waitForSelector('#originalSizeImage');
  // 截图后转为 base64 的图片
  const data = await originalSizeImage.screenshot();
  core.info('✅ screenshot')
  await page.evaluate((base64) => {
    let screenshotImage = document.querySelector('#screenshotImage');
    if (!screenshotImage) {
      screenshotImage = new Image;
      screenshotImage.id = 'screenshotImage';
      document.body.appendChild(screenshotImage);
    }
    screenshotImage.src = `data:image/png;base64,${base64}`;
  }, data.toString('base64'));
  core.info('✅ set to canvas')

  await smallImage.evaluate(e => { e.style.display = "unset" })
  const originalBigImageBox = await originalSizeImage.boundingBox();
  const bigImageBox = await bigImage.boundingBox();
  const smallImageBox = await smallImage.boundingBox();
  await originalSizeImage.evaluate(e => document.body.removeChild(e));

  // 计算缩放比例
  const scaleX = originalBigImageBox.width / bigImageBox.width;
  const scaleY = originalBigImageBox.height / bigImageBox.height;
  globalData = {
    scaleX,
    scaleY,
    smallImageBox,
    bigImageBox,
    clickPosition: {
      x: smallImageBox.x + 30,
      y: smallImageBox.y + 30,
    },
    // 大图片内部的采样线高度位置 = (小图片顶部 - 大图片顶部 + 向下少量的偏移) * 缩放比例
    sampleLineY: Math.floor((smallImageBox.y - bigImageBox.y + 20) * scaleY),
  }
  core.info('✅ get global data')
}
/**
 * 计算按钮需要滑动的距离
 * */
async function calculateDistance() {
  const distance = await page.evaluate((_globalData) => {

    function convertImageToCanvas(img) {
      let canvas = document.querySelector('#my-canvas');
      if (!canvas) {
        // 创建canvas DOM元素，并设置其宽高和图片一样
        canvas = document.createElement("canvas");
        canvas.id = 'my-canvas';
        document.body.appendChild(canvas);
      }
      canvas.width = img.width;
      canvas.height = img.height;
      // 坐标(0,0) 表示从此处开始绘制，相当于偏移。
      canvas.getContext("2d").drawImage(img, 0, 0);
      return canvas;
    }

    // 相邻点差值检测
    function adjacentPointsDiff(lineData) {
      const pixelData = [];
      const gap = [];
      for (let index = 0; index < lineData.length; index += 4) {
        const [r, g, b, a] = [
          lineData[index],
          lineData[index + 1],
          lineData[index + 2],
          lineData[index + 3]
        ];
        const average = Math.floor((r + g + b) / 3);
        // core.info(
        //   `%c ${index} ${average}`,
        //   `background: rgba(${r}, ${g}, ${b}, ${a}); color: #000`
        // );
        const before = pixelData[pixelData.length - 1];
        const diff = before - average;
        if (diff > 150) {
          core.info("gap: ", pixelData[pixelData.length - 1], average);
          gap.push(index / 4);
        }
        pixelData.push(average);
      }
      if (gap.length > 0 && gap.length <= 2) {
        // 最多匹配到两个点，左边和右边，超过的话认为找的有问题
        return gap[0];
      }
    }

    // 定宽采样检测，识别率低
    function fixedWidthSample(lineData, smallImgWidth = 68) {
      const pixelData = [];
      for (let index = 0; index < lineData.length; index += 4) {
        const [r, g, b, a] = [
          lineData[index],
          lineData[index + 1],
          lineData[index + 2],
          lineData[index + 3]
        ];
        const average = Math.floor((r + g + b) / 3);
        pixelData.push(average);
      }
      const sampleRate = 12;
      const p = Math.floor(smallImgWidth / sampleRate);
      let first = 0;
      let min = 255;
      for (let i = smallImgWidth * 1.5; i < pixelData.length; i += p) {
        let sum = 0;
        for (let j = 0; j < sampleRate; j++) {
          sum += pixelData[i + p * j] || 255;
          lineData[i * 4 + 1] = 255;
        }
        const avg = Math.floor(sum / sampleRate);
        if (avg < min) {
          first = i;
          min = avg;
        }
      }
      return first;
    }

    function convertToCanvasAndFindGap(img, yPosition) {
      if (!img) return;
      const canvas = convertImageToCanvas(img);
      const sampleLine = canvas.getContext("2d").getImageData(0, yPosition, img.width, 1);
      return adjacentPointsDiff(sampleLine.data);
    }

    function markDiv(x, y) {
      let div = document.querySelector('#my-div');
      if (!div) {
        div = document.createElement('div');
        div.id = 'my-div';
        div.style.zIndex = 999;
        div.style.width = '68px';
        div.style.height = '68px';
        div.style.position = 'fixed';
        div.style.pointerEvents = 'none';
        div.style.border = '1px solid red';
        document.body.appendChild(div);
      }
      div.style.left = `${x}px`;
      div.style.top = `${y}px`;
    }

    function markPoint(x, y) {
      let div = document.querySelector('#my-point');
      if (!div) {
        div = document.createElement('div');
        div.id = 'my-point';
        div.style.zIndex = 9999;
        div.style.width = '2px';
        div.style.height = '2px';
        div.style.position = 'fixed';
        div.style.pointerEvents = 'none';
        div.style.backgroundColor = 'red';
        document.body.appendChild(div);
      }
      div.style.left = `${x}px`;
      div.style.top = `${y}px`;
    }

    function markLine(x, y) {
      let div = document.querySelector('#my-line');
      if (!div) {
        div = document.createElement('div');
        div.id = 'my-line';
        div.style.zIndex = 999;
        div.style.width = '350px';
        div.style.height = '1px';
        div.style.position = 'fixed';
        div.style.pointerEvents = 'none';
        div.style.backgroundColor = 'yellow';
        document.body.appendChild(div);
      }
      div.style.left = `${x}px`;
      div.style.top = `${y}px`;
    }

    const screenshotImage = document.querySelector('#screenshotImage');
    const distance = convertToCanvasAndFindGap(screenshotImage, _globalData.sampleLineY) || 0;
    markPoint(_globalData.clickPosition.x, _globalData.clickPosition.y);
    markLine(_globalData.smallImageBox.x, _globalData.bigImageBox.y + _globalData.sampleLineY / _globalData.scaleY);
    markDiv(_globalData.smallImageBox.x + distance / _globalData.scaleX, _globalData.smallImageBox.y);

    return distance / _globalData.scaleX;
  }, globalData)
  return distance;
}

/**
* 尝试滑动按钮
* @param distance 滑动距离
* */
async function drag(distance) {
  //将距离拆分成两段，模拟正常人的行为
  const distance1 = distance - 5
  const distance2 = 5
  if (!distance) return;

  const { x, y } = globalData.clickPosition;
  const smallImagePadding = 4;
  await page.mouse.move(x, y)
  await page.mouse.down()
  await timeout(200);
  await page.mouse.move(x + distance1 - smallImagePadding, y, { steps: 30 })
  await timeout(300);
  await page.mouse.move(x + distance1 + distance2 - smallImagePadding, y, { steps: 5 })
  await timeout(800);
  await page.mouse.up()
  await page.waitForNavigation({ timeout: 10000 });
  // 成功后可以找到头像图片
  return page.$('img.avatar')
}
/**
* 验证并检查是否通过
* */
async function tryValidation() {
  const distance = await calculateDistance();
  if (debug) {
    await timeout(5000);
    await verifyCaptcha()
    return;
  }
  const isSuccess = await drag(distance)
  if (isSuccess) {
    //登录
    core.info('✅ verify success')
    return isSuccess;
  } else {
    core.error('❌ verify failed, retry')
    await page.click(refreshBtnSelector);
    await timeout(2000);
    return verifyCaptcha()
  }
}

module.exports = run;
